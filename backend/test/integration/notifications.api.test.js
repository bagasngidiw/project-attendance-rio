/**
 * Integration tests for Notifications (FR-014 / FR-015): event-driven inbox,
 * unread counts, mark-read flows, and preferences.
 *
 * Runs against the dedicated `attendance_notifications_test` database.
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
  process.env.MONGO_URI_NOTIFICATIONS_TEST || "mongodb://127.0.0.1:27017/attendance_notifications_test";

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

test("A5: submit notifies the approver; decide notifies the requester; read flows work", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  // Submit a leave -> auto-resolved ROLE target; the manager (eligible approver
  // + manager-of-requester) is still notified on submission.
  const leave = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  assert.equal(leave.status, 201);

  // Approver receives a request.assigned notification.
  const inbox = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(inbox.status, 200);
  const assigned = inbox.body.data.items.find((n) => n.type === "request.assigned");
  assert.ok(assigned, "approver notified on submission");
  assert.equal(assigned.relatedRequestId, leave.body.data.id);

  const unread = await request(app)
    .get("/api/v1/notifications/unread-count")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.ok(unread.body.data.unread >= 1);

  // FR-007: the role-targeted request must be claimed before deciding.
  const claim = await request(app)
    .post(`/api/v1/requests/${leave.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  // Manager approves -> requester is notified.
  await request(app)
    .post(`/api/v1/approvals/${leave.body.data.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "APPROVED", comment: "ok" });

  const requesterInbox = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  const decided = requesterInbox.body.data.items.find((n) => n.type === "request.decided");
  assert.ok(decided, "requester notified of the decision");
  assert.ok(decided.body.includes("approved"));

  // Mark one read + read-all.
  const markRead = await request(app)
    .post(`/api/v1/notifications/${decided.id}/read`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(markRead.status, 200);
  assert.ok(markRead.body.data.readAt);

  const readAll = await request(app)
    .post("/api/v1/notifications/read-all")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(readAll.status, 200);

  const unreadAfter = await request(app)
    .get("/api/v1/notifications/unread-count")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(unreadAfter.body.data.unread, 0);

  // A user cannot mark another user's notification read (404).
  const other = await signIn("employee.bob", "Employee2026!");
  const denied = await request(app)
    .post(`/api/v1/notifications/${decided.id}/read`)
    .set("Authorization", `Bearer ${other.accessToken}`);
  assert.equal(denied.status, 404);
});

test("A9: preferences opt-out honored; mandatory types cannot be opted out", async () => {
  const employee = await signIn("employee", "Employee2026!");

  // Mandatory types rejected.
  const rejected = await request(app)
    .put("/api/v1/notifications/preferences")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ optOutTypes: ["request.assigned"] });
  assert.equal(rejected.status, 400);

  // Opt out of request.decided; a subsequent decision is not delivered.
  const updated = await request(app)
    .put("/api/v1/notifications/preferences")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ optOutTypes: ["request.decided"] });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.data.optOutTypes, ["request.decided"]);

  const manager = await signIn("manager", "Manager2026!");
  const leave = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "SICK", startDate: "2026-09-05", endDate: "2026-09-05", reason: "Flu" });
  // FR-007: claim the role-targeted request before deciding.
  await request(app)
    .post(`/api/v1/requests/${leave.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  await request(app)
    .post(`/api/v1/approvals/${leave.body.data.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "REJECTED", comment: "no" });

  const inbox = await request(app)
    .get("/api/v1/notifications")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.ok(
    !inbox.body.data.items.some((n) => n.type === "request.decided"),
    "opted-out type not delivered"
  );
});
