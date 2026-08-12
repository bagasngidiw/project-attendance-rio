/**
 * Integration regression for the leave-balance lifecycle (TODO.md FR-001/002/003).
 *
 * Bug: an employee with 12 days of quota submitted 4 days of Annual Leave that
 * was approved, yet the balance stayed 12. Root causes: LeaveBalanceService was
 * never subscribed to the EventBus in the composition root, and resolveLeaveTypeId
 * only resolved legacy keys (the form sends the leaveType ObjectId).
 *
 * This test drives the REAL HTTP stack (Express routes → middleware → services →
 * MongoDB) and asserts:
 *   reserve on submit   : 12 → (submit 4 days) → 8
 *   consume on approve  : 8  → (approve)       → 8 (consumed 4, reserved 0)
 *   release on reject   : 8  → (reject)        → 12 (reserved 0, consumed 0)
 *
 * It is RED without the FR-001 wiring (the reserve/consume/release never runs).
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
  process.env.MONGO_URI_LEAVE_BALANCE_TEST ||
  "mongodb://127.0.0.1:27017/attendance_leave_balance_test";

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

async function adminToken() {
  return (await signIn("superadmin", createConfig().seed.superAdminPassword)).accessToken;
}

async function employeeRoleId() {
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  return role.id.toString();
}

async function annualLeaveTypeId(token) {
  const res = await request(app)
    .get("/api/v1/leave/types")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const annual = (res.body.data?.items ?? []).find((t) => t.key === "ANNUAL");
  assert.ok(annual, "seeded ANNUAL leave type present");
  return annual.id;
}

/** The ANNUAL balance row for a user via the real API (superadmin can read). */
async function annualBalance(token, userId) {
  const res = await request(app)
    .get("/api/v1/leave/balances")
    .set("Authorization", `Bearer ${token}`)
    .query({ userId, year: 2026 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const item = (res.body.data ?? []).find((i) => i.leaveTypeKey === "ANNUAL");
  assert.ok(item, "ANNUAL balance row present");
  return item;
}

async function createEmployeeWithQuota(token, username, quotaDays) {
  const roleId = await employeeRoleId();
  const res = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${token}`)
    .send({
      username,
      email: `${username}@corp.io`,
      name: username,
      roleIds: [roleId],
      initialPassword: "Balance2026!x",
      jatahCuti: quotaDays,
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.id;
}

async function submitAnnualLeave(employeeToken, annualTypeId, startDate, endDate) {
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employeeToken}`)
    .send({
      leaveType: annualTypeId, // ObjectId — FR-002 resolution path
      startDate,
      endDate,
      reason: "Family vacation",
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.id;
}

async function claimAndDecide(managerToken, requestId, action, body = {}) {
  const claim = await request(app)
    .post(`/api/v1/requests/${requestId}/claim`)
    .set("Authorization", `Bearer ${managerToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const decide = await request(app)
    .post(`/api/v1/requests/${requestId}/${action}`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send(body);
  assert.equal(decide.status, 200, JSON.stringify(decide.body));
}

test("leave balance lifecycle: reserve on submit, consume on approve (12 → 8 → 8)", async () => {
  const token = await adminToken();
  const annualTypeId = await annualLeaveTypeId(token);

  // Employee with a 12-day quota — creating the user seeds the entitlement.
  const userId = await createEmployeeWithQuota(token, "emp.balance1", 12);
  const initial = await annualBalance(token, userId);
  assert.equal(initial.entitlementDays, 12);
  assert.equal(initial.balance, 12, "balance starts at the full quota");

  // Submit 4 days of ANNUAL leave using the leaveType ObjectId (FR-002).
  const employee = await signIn("emp.balance1", "Balance2026!x");
  const requestId = await submitAnnualLeave(
    employee.accessToken,
    annualTypeId,
    "2026-09-01",
    "2026-09-04"
  );

  // Reserved on submit: 12 - 4 = 8.
  const reserved = await annualBalance(token, userId);
  assert.equal(reserved.balance, 8, "4 days reserved after submit");
  assert.equal(reserved.reservedDays, 4);
  assert.equal(reserved.consumedDays, 0);

  // Approve: reserved converts to consumed, balance stays 8.
  const manager = await signIn("manager", "Manager2026!");
  await claimAndDecide(manager.accessToken, requestId, "approve");

  const consumed = await annualBalance(token, userId);
  assert.equal(consumed.balance, 8, "balance unchanged after approval");
  assert.equal(consumed.consumedDays, 4);
  assert.equal(consumed.reservedDays, 0);
});

test("leave balance lifecycle: rejected request releases the reservation (12 → 8 → 12)", async () => {
  const token = await adminToken();
  const annualTypeId = await annualLeaveTypeId(token);

  const userId = await createEmployeeWithQuota(token, "emp.balance2", 12);
  const initial = await annualBalance(token, userId);
  assert.equal(initial.balance, 12);

  const employee = await signIn("emp.balance2", "Balance2026!x");
  const requestId = await submitAnnualLeave(
    employee.accessToken,
    annualTypeId,
    "2026-09-01",
    "2026-09-04"
  );

  const reserved = await annualBalance(token, userId);
  assert.equal(reserved.balance, 8, "4 days reserved after submit");
  assert.equal(reserved.reservedDays, 4);

  // Reject with a mandatory reason: reservation released, balance restored.
  const manager = await signIn("manager", "Manager2026!");
  await claimAndDecide(manager.accessToken, requestId, "reject", {
    reason: "Not enough coverage this period.",
  });

  const released = await annualBalance(token, userId);
  assert.equal(released.balance, 12, "balance restored after rejection");
  assert.equal(released.reservedDays, 0);
  assert.equal(released.consumedDays, 0);
});
