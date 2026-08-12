/**
 * FR-007 integration tests: submitting a request without an explicit
 * approvalTarget auto-resolves the default eligible role target (highest
 * level, targetable, with eligible users) and persists a configuration
 * snapshot; the request stays claimable. Explicit targets are still honored.
 *
 * Runs against the dedicated `attendance_auto_target_test` database.
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
  process.env.MONGO_URI_AUTO_TARGET_TEST || "mongodb://127.0.0.1:27017/attendance_auto_target_test";

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

test("FR-007: targetless submissions auto-assign the default eligible role across modules", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  // LEAVE
  const leave = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-10-01", endDate: "2026-10-02", reason: "Cuti" });
  assert.equal(leave.status, 201, JSON.stringify(leave.body));
  assert.equal(leave.body.data.approval.targetType, "ROLE");
  assert.equal(leave.body.data.approval.assignedUserId, null, "role target is claimable");
  assert.ok(leave.body.data.approval.configurationSnapshot.targetRoleId, "snapshot persisted");

  // TRIP
  const trip = await request(app)
    .post("/api/v1/trip/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ destination: "Jakarta", startDate: "2026-11-01", endDate: "2026-11-02", purpose: "Meeting" });
  assert.equal(trip.status, 201, JSON.stringify(trip.body));
  assert.equal(trip.body.data.approval.targetType, "ROLE");

  // SAKIT (system type UMUM is seeded active)
  const types = await request(app)
    .get("/api/v1/sickness-types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  const umum = types.body.data.find((t) => t.key === "UMUM");
  const sakit = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ sicknessType: umum.id, startDate: "2026-11-10", reason: "Sakit" });
  assert.equal(sakit.status, 201, JSON.stringify(sakit.body));
  assert.equal(sakit.body.data.approval.targetType, "ROLE");

  // PERMISSION
  const permission = await request(app)
    .post("/api/v1/permission/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ date: "2026-12-01", reason: "Urusan keluarga" });
  assert.equal(permission.status, 201, JSON.stringify(permission.body));
  assert.equal(permission.body.data.approval.targetType, "ROLE");

  // The auto-targeted requests are claimable by an eligible approver.
  const claim = await request(app)
    .post(`/api/v1/requests/${leave.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.data.approval.assignedUserId, manager.user.id);
});

test("FR-007: an explicit user target is preferred over auto-resolution", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      reason: "Cuti",
      approvalTarget: { targetType: "USER", targetUserId: manager.user.id },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.approval.targetType, "USER");
  assert.equal(String(sub.body.data.approval.assignedUserId), manager.user.id);
  assert.equal(String(sub.body.data.approverId), manager.user.id);
});

test("FR-007: an invalid explicit role target is still rejected (404, no existence leak)", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const bad = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      reason: "Cuti",
      approvalTarget: { targetType: "ROLE", targetRoleId: "5f0000000000000000000000" },
    });
  assert.equal(bad.status, 404, JSON.stringify(bad.body));
  assert.equal(bad.body.error.code, "ROLE_NOT_FOUND");
});
