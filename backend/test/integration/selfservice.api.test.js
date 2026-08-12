/**
 * Integration tests for Employee Self-Service (FR-037 / FR-021): profile
 * updates with audit, consolidated request history with summaries, and
 * requester-scope enforcement.
 *
 * Runs against the dedicated `attendance_selfservice_test` database.
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
  process.env.MONGO_URI_SELFSERVICE_TEST || "mongodb://127.0.0.1:27017/attendance_selfservice_test";

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

test("E3: an employee reads and updates their own profile with audit; HR fields rejected", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const read = await request(app)
    .get("/api/v1/profile/me")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.data.username, "employee");
  assert.ok(read.body.data.roles.includes("EMPLOYEE"));

  const update = await request(app)
    .put("/api/v1/profile/me")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ phone: "+1-555-0199", address: "Main Street 10", bankAccount: "1234567890" });
  assert.equal(update.status, 200);
  assert.equal(update.body.data.phone, "+1-555-0199");
  assert.equal(update.body.data.bankAccount, "****7890", "bank account masked");

  // HR-managed fields are rejected.
  const rejected = await request(app)
    .put("/api/v1/profile/me")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ name: "Hacker" });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, "FIELD_NOT_EDITABLE");

  // PROFILE.UPDATED is recorded in the audit trail.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "PROFILE.UPDATED", pageSize: 100 });
  assert.ok(audit.body.data.total >= 1, "PROFILE.UPDATED in audit trail");
});

test("E4: /requests/mine returns a consolidated history across types with summaries", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const leave = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  assert.equal(leave.status, 201);

  await request(app)
    .post("/api/v1/overtime/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "Catch-up" });

  // Manager claims the role-targeted request, then approves so a decision
  // summary is present.
  const manager = await signIn("manager", "Manager2026!");
  const claim = await request(app)
    .post(`/api/v1/requests/${leave.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const approved = await request(app)
    .post(`/api/v1/approvals/${leave.body.data.id}/decide`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ decision: "APPROVED", comment: "Approved" });
  assert.equal(approved.status, 200);

  const mine = await request(app)
    .get("/api/v1/requests/mine")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.total, 2, "both request types appear");

  const leaveItem = mine.body.data.items.find((r) => r.type === "LEAVE");
  assert.ok(leaveItem.summary.includes("ANNUAL cuti"), "human-readable summary");
  assert.deepEqual(leaveItem.dates, { startDate: "2026-09-01", endDate: "2026-09-03" });
  assert.equal(leaveItem.decisionSummary.action, "APPROVED");
  assert.equal(leaveItem.decisionSummary.comment, "Approved");

  // Filters return the expected subset.
  const overtimeOnly = await request(app)
    .get("/api/v1/requests/mine")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .query({ type: "OVERTIME" });
  assert.equal(overtimeOnly.body.data.total, 1);
  assert.equal(overtimeOnly.body.data.items[0].type, "OVERTIME");
});

test("E5: an out-of-scope request detail returns 404", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const leave = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "SICK", startDate: "2026-09-01", endDate: "2026-09-01", reason: "Flu" });
  assert.equal(leave.status, 201);

  // The manager is the approver but NOT the requester — 404 (no existence leak).
  const manager = await signIn("manager", "Manager2026!");
  const hidden = await request(app)
    .get(`/api/v1/requests/${leave.body.data.id}`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "REQUEST_NOT_FOUND");
});
