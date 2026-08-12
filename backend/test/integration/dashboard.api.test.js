/**
 * Integration tests for the Dashboard surface (FR-025 / FR-026): personal
 * summary scoping, HR statistics, and permission gates.
 *
 * Runs against the dedicated `attendance_dashboard_test` database.
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
  process.env.MONGO_URI_DASHBOARD_TEST || "mongodb://127.0.0.1:27017/attendance_dashboard_test";

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
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

const VERIFY_BODY = { location: { latitude: -6.2, longitude: 106.8, accuracy: 12, permissionState: "granted", acquisitionStatus: "found" }, camera: { status: "captured", capturedAt: new Date().toISOString(), mediaRef: "/api/v1/attendance/media/test" }, device: { category: "desktop", browser: "test", os: "test", cameraAvailable: true, locationAvailable: true } };
async function signIn(username, password) {
  const res = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

test("E4: the employee personal dashboard reflects only their own data", async () => {
  const employee = await signIn("employee", "Employee2026!");

  // Clock in and submit a leave request so the dashboard has data.
  await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });

  const res = await request(app)
    .get("/api/v1/dashboard/me")
    .set("Authorization", `Bearer ${employee.accessToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.attendanceToday.status, "CLOCKED_IN");
  assert.equal(res.body.data.requestSummary.pending, 1);
  assert.equal(res.body.data.requestSummary.byType.leave, 1);
  assert.equal(res.body.data.recentRequests.length, 1);
  assert.equal(res.body.data.recentRequests[0].status, "PENDING_APPROVAL");
  assert.ok(res.body.data.quickActions.includes("attendance:clock_out"));
  assert.ok(res.body.data.quickActions.includes("leave:submit"));
});

test("E5: the HR dashboard reports company-wide statistics consistent with module data", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${manager.accessToken}`);

  const hr = await signIn("hradmin", "HrAdmin2026!");
  const res = await request(app)
    .get("/api/v1/dashboard/hr")
    .set("Authorization", `Bearer ${hr.accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.workforce.totalActiveEmployees >= 5, "demo workforce counted");
  assert.equal(res.body.data.pendingRequests.leave, 1, "pending leave matches module data");
  assert.equal(res.body.data.attendanceSummary.clockedInToday, 1, "clocked-in manager counted");
  assert.ok(Array.isArray(res.body.data.workforce.byDepartment));
});

test("E6: a user without dashboard:view gets 403 on the dashboard", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");
  const hasher = new Hasher(4);
  await UserModel.create({
    username: "nodash",
    email: "nodash@corp.io",
    name: "No Dash",
    passwordHash: await hasher.hash("NoDash2026!"),
    status: "ACTIVE",
  });

  const user = await signIn("nodash", "NoDash2026!");
  const res = await request(app)
    .get("/api/v1/dashboard/me")
    .set("Authorization", `Bearer ${user.accessToken}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_DENIED");
});
