/**
 * Integration tests for the Request Lifecycle & Submission cluster
 * (FR-016 / FR-036 / FR-054): leave/overtime/trip submission, cancellation
 * rules, permission gates, requester scope, and pending-summary integration.
 *
 * Runs against the dedicated `attendance_requests_test` database.
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
  process.env.MONGO_URI_REQUESTS_TEST || "mongodb://127.0.0.1:27017/attendance_requests_test";

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

test("F5: submitting leave creates PENDING + history + audit and bumps the pending summary", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Family vacation",
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, "PENDING_APPROVAL");
  assert.equal(res.body.data.type, "LEAVE");
  assert.equal(res.body.data.payload.leaveType, "ANNUAL");
  assert.ok(res.body.data.submittedAt);

  // FR-007: no explicit target -> the engine auto-resolves the default eligible
  // ROLE target (highest-level targetable role with users) and persists the
  // configuration snapshot; the request stays claimable (assignedUserId null).
  assert.equal(res.body.data.approval.targetType, "ROLE");
  assert.equal(res.body.data.approval.assignedUserId, null, "role target is claimable");
  assert.equal(res.body.data.approval.configurationSnapshot.targetRoleName, "HR Administrator");
  assert.equal(res.body.data.approverId, null, "no direct approver for a role target");

  const requestId = res.body.data.id;

  // History timeline records the SUBMITTED + ASSIGNED transitions.
  const detail = await request(app)
    .get(`/api/v1/requests/${requestId}`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(detail.status, 200);
  const timeline = detail.body.data.events.map((e) => e.event);
  assert.deepEqual(timeline, ["SUBMITTED", "ASSIGNED"]);
  assert.equal(detail.body.data.events[0].fromStatus, "DRAFT");
  assert.equal(detail.body.data.events[0].toStatus, "PENDING_APPROVAL");

  // Audit trail records LEAVE.SUBMITTED.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "LEAVE.SUBMITTED", pageSize: 100 });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.total >= 1, "LEAVE.SUBMITTED in audit trail");
  assert.equal(audit.body.data.items[0].metadata.requestId, requestId);

  // PendingSummary (FR-006) reflects the new pending leave for the manager.
  const manager = await signIn("manager", "Manager2026!");
  const team = await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(team.status, 200);
  assert.equal(team.body.data.pendingSummary.leave, 1);
});

test("F5b: overtime and trip submissions work with their payloads", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const overtime = await request(app)
    .post("/api/v1/overtime/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "Catch-up" });
  assert.equal(overtime.status, 201);
  assert.equal(overtime.body.data.status, "PENDING_APPROVAL");
  assert.equal(overtime.body.data.type, "OVERTIME");

  const trip = await request(app)
    .post("/api/v1/trip/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ destination: "Singapore", startDate: "2026-10-01", endDate: "2026-10-05", purpose: "Client visit" });
  assert.equal(trip.status, 201);
  assert.equal(trip.body.data.status, "PENDING_APPROVAL");
  assert.equal(trip.body.data.type, "TRIP");

  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "TRIP.SUBMITTED", pageSize: 100 });
  assert.ok(audit.body.data.total >= 1, "TRIP.SUBMITTED audited");
});

test("F6: cancel works while PENDING and is blocked after a decision", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const created = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "SICK", startDate: "2026-09-01", endDate: "2026-09-01", reason: "Flu" });
  const requestId = created.body.data.id;

  const cancelled = await request(app)
    .post(`/api/v1/requests/${requestId}/cancel`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ reason: "Feeling better" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal(cancelled.body.data.cancellationReason, "Feeling better");

  // History shows SUBMITTED, ASSIGNED (FR-007 auto target), then CANCELLED.
  const detail = await request(app)
    .get(`/api/v1/requests/${requestId}`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.deepEqual(detail.body.data.events.map((e) => e.event), ["SUBMITTED", "ASSIGNED", "CANCELLED"]);

  // A decided request cannot be cancelled (simulated decision via the store,
  // since the approve route ships with FR-007).
  const created2 = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-05", endDate: "2026-09-06", reason: "Trip" });
  const requestId2 = created2.body.data.id;
  const { RequestModel } = require("../../src/infrastructure/models/request.model");
  await RequestModel.updateOne(
    { _id: requestId2 },
    { $set: { status: "APPROVED", decidedAt: new Date(), version: 2 } }
  );

  const blocked = await request(app)
    .post(`/api/v1/requests/${requestId2}/cancel`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ reason: "late" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "INVALID_STATUS_TRANSITION");
});

test("F7: an employee without leave:submit gets 403 on submit", async () => {
  // Provision a user with no roles (no permissions) and sign in.
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");
  const hasher = new Hasher(4);
  await UserModel.create({
    username: "norole",
    email: "norole@corp.io",
    name: "No Role",
    passwordHash: await hasher.hash("NoRole2026!"),
    status: "ACTIVE",
  });

  const user = await signIn("norole", "NoRole2026!");
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-02", reason: "x" });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_DENIED");
});

test("F8: /requests/mine returns only the requester's requests with filters and pagination", async () => {
  const employee = await signIn("employee", "Employee2026!");

  await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-02", reason: "A" });
  await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "SICK", startDate: "2026-09-03", endDate: "2026-09-03", reason: "B" });
  await request(app)
    .post("/api/v1/overtime/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "C" });

  // Another user's requests are invisible.
  const other = await signIn("manager", "Manager2026!");
  await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${other.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-12-01", endDate: "2026-12-02", reason: "mine" });

  const mine = await request(app)
    .get("/api/v1/requests/mine")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.total, 3);
  assert.ok(mine.body.data.items.every((r) => String(r.requesterId) === String(employee.user.id)));

  const leaves = await request(app)
    .get("/api/v1/requests/mine")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .query({ type: "LEAVE" });
  assert.equal(leaves.body.data.total, 2);

  const pending = await request(app)
    .get("/api/v1/requests/mine")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .query({ status: "PENDING", pageSize: 2 });
  assert.equal(pending.body.data.items.length, 2);
  assert.equal(pending.body.data.total, 3);

  // A non-owner cannot read another user's request detail.
  const employeeReq = mine.body.data.items[0];
  const hidden = await request(app)
    .get(`/api/v1/requests/${employeeReq.id}`)
    .set("Authorization", `Bearer ${other.accessToken}`);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "REQUEST_NOT_FOUND");
});

test("FR-058: configured leave types drive the submission form and guard submissions", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  // The system types are seeded and available on the form.
  const types = await request(app)
    .get("/api/v1/leave/types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(types.status, 200);
  const keys = types.body.data.items.map((t) => t.key);
  assert.ok(keys.includes("ANNUAL"));
  assert.ok(keys.includes("SICK"));

  // Super Admin creates a new leave type.
  const created = await request(app)
    .post("/api/v1/admin/leave-types")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: "MATERNITY", name: "Maternity Leave", isBalanceBased: true });
  assert.equal(created.status, 201);

  const afterCreate = await request(app)
    .get("/api/v1/leave/types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.ok(afterCreate.body.data.items.some((t) => t.key === "MATERNITY"));

  // Submitting with the new active type works.
  const submitted = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "MATERNITY", startDate: "2026-09-01", endDate: "2026-09-05", reason: "New arrival" });
  assert.equal(submitted.status, 201);

  // Deactivating the type hides it from the form and blocks new submissions.
  await request(app)
    .post(`/api/v1/admin/leave-types/${created.body.data.id}/deactivate`)
    .set("Authorization", `Bearer ${admin.accessToken}`);

  const afterDeactivate = await request(app)
    .get("/api/v1/leave/types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.ok(!afterDeactivate.body.data.items.some((t) => t.key === "MATERNITY"));

  const blocked = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "MATERNITY", startDate: "2026-10-01", endDate: "2026-10-02", reason: "Second" });
  assert.equal(blocked.status, 400);

  // A non-admin cannot manage leave types.
  const denied = await request(app)
    .post("/api/v1/admin/leave-types")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ key: "X", name: "X" });
  assert.equal(denied.status, 403);
});
