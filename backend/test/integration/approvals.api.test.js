/**
 * Integration tests for the Approval Workflow cluster (FR-007 / FR-008 /
 * FR-042): inbox, decisions, history, routing configuration, and permission
 * gates.
 *
 * Runs against the dedicated `attendance_approvals_test` database.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");

require("dotenv").config();

const { buildApp } = require("../../server");
const { createConfig } = require("../../src/infrastructure/config");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { seedDatabase } = require("../../src/infrastructure/seed/seed");

const TEST_URI =
  process.env.MONGO_URI_APPROVALS_TEST || "mongodb://127.0.0.1:27017/attendance_approvals_test";

let app;
let config;

before(async () => {
  config = createConfig();
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const { app: built } = buildApp(config);
  app = built;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const { app: built, repositories } = buildApp(config);
  app = built;
  await seedDatabase({
    roleRepository: repositories.roleRepository,
    permissionRepository: repositories.permissionRepository,
    userRepository: repositories.userRepository,
    leaveTypeRepository: repositories.leaveTypeRepository,
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    approvalConfigurationRepository: repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

async function signIn(username, password) {
  const res = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function submitLeave(asToken) {
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${asToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

test("F5: submit → claim → approve → APPROVED + history + audit", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const req = await submitLeave(employee.accessToken);

  // FR-007: no explicit target -> auto-resolved ROLE target, claimable.
  assert.equal(req.approval.targetType, "ROLE");
  assert.equal(req.approval.assignedUserId, null);
  assert.equal(req.approverId, null);

  // The demo manager is an eligible approver and claims the request.
  const manager = await signIn("manager", "Manager2026!");
  const claim = await request(app)
    .post(`/api/v1/requests/${req.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.data.approval.assignedUserId, manager.user.id);

  // Inbox shows the pending request (now assigned to the manager).
  const inbox = await request(app)
    .get("/api/v1/approvals/inbox")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.data.total, 1);
  assert.equal(inbox.body.data.items[0].id, req.id);

  // Approve.
  const decided = await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "APPROVED", comment: "Approved" });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.data.status, "APPROVED");
  assert.equal(decided.body.data.decision.action, "APPROVED");

  // Requester sees the decision in history.
  const history = await request(app)
    .get(`/api/v1/requests/${req.id}/history`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.data.events.map((e) => e.event), ["SUBMITTED", "ASSIGNED", "CLAIMED", "APPROVED"]);

  // Audit trail records REQUEST.APPROVED with the approver.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "REQUEST.APPROVED", pageSize: 100 });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.total >= 1, "REQUEST.APPROVED in audit trail");
});

test("F6: a rejection without a reason is blocked (FR-002: reason mandatory)", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const req = await submitLeave(employee.accessToken);

  // FR-007: the role-targeted request must be claimed before deciding.
  const claim = await request(app)
    .post(`/api/v1/requests/${req.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  // FR-002/agents.md §16/§29: the rejection reason is mandatory.
  const rejectedBlank = await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "REJECTED", comment: "" });
  assert.equal(rejectedBlank.status, 400, "rejection without a reason is blocked");

  const rejected = await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "REJECTED", comment: "Insufficient leave balance" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(rejected.body.data.decision.comment, "Insufficient leave balance");
});

test("F7: a decided request leaves the inbox and appears in approval history", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const req = await submitLeave(employee.accessToken);
  await request(app)
    .post(`/api/v1/requests/${req.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "APPROVED" });

  const inbox = await request(app)
    .get("/api/v1/approvals/inbox")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(inbox.body.data.total, 0, "decided request leaves the inbox");

  const history = await request(app)
    .get("/api/v1/approvals/history")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(history.body.data.total, 1, "decided-by-me appears in history");
  assert.equal(history.body.data.items[0].id, req.id);
});

test("F8: a non-assigned approver gets 404; a user without approve permission gets 403", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const req = await submitLeave(employee.accessToken);

  // HR admin holds leave:approve but is NOT the assigned approver → 404.
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const notAssigned = await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ decision: "APPROVED" });
  assert.equal(notAssigned.status, 404);
  assert.equal(notAssigned.body.error.code, "REQUEST_NOT_FOUND");

  // An employee without any approve permission is blocked at the boundary → 403.
  const other = await signIn("employee.bob", "Employee2026!");
  const denied = await request(app)
    .post(`/api/v1/approvals/${req.id}/decide`)
    .set("Authorization", `Bearer ${other.accessToken}`)
    .send({ decision: "APPROVED" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "AUTH_DENIED");
});

test("F9: routing rule changes are persisted and audited; non-admins are denied", async () => {
  const superAdmin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  const update = await request(app)
    .put("/api/v1/admin/routing")
    .set("Authorization", `Bearer ${superAdmin.accessToken}`)
    .send({
      rules: [
        { requestType: "LEAVE", levels: [{ source: "MANAGER_OF_REQUESTER" }], fallback: "ACTIVE_HR_ADMIN", enabled: true },
        { requestType: "OVERTIME", levels: [{ source: "MANAGER_OF_REQUESTER" }], fallback: "SUPER_ADMIN", enabled: true },
        { requestType: "TRIP", levels: [{ source: "MANAGER_OF_REQUESTER" }], fallback: "ACTIVE_HR_ADMIN", enabled: false },
      ],
    });
  assert.equal(update.status, 200);
  // All request types are returned (LEAVE/OVERTIME/TRIP/PERMISSION/SAKIT);
  // the PUT only overrides the submitted rules and preserves the rest.
  assert.equal(update.body.data.length, 5);

  const read = await request(app)
    .get("/api/v1/admin/routing")
    .set("Authorization", `Bearer ${superAdmin.accessToken}`);
  assert.equal(read.status, 200);
  const tripRule = read.body.data.find((r) => r.requestType === "TRIP");
  assert.equal(tripRule.enabled, false, "stored rule persisted");

  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${superAdmin.accessToken}`)
    .query({ action: "SETTINGS.CHANGED", pageSize: 100 });
  assert.ok(audit.body.data.total >= 1, "routing change audited");

  // HR admin lacks platform:settings → 403.
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const denied = await request(app)
    .put("/api/v1/admin/routing")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ rules: [{ requestType: "LEAVE", levels: [{ source: "MANAGER_OF_REQUESTER" }], fallback: "ACTIVE_HR_ADMIN", enabled: true }] });
  assert.equal(denied.status, 403);
});
