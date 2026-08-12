/**
 * Integration tests for the Attendance module (FR-035 / FR-020 / FR-041):
 * clock in/out, personal history, HR corrections, and the HR overview with
 * filters and scope enforcement.
 *
 * Runs against the dedicated `attendance_attendance_test` database.
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
  process.env.MONGO_URI_ATTENDANCE_TEST || "mongodb://127.0.0.1:27017/attendance_attendance_test";

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

test("F4: employee clocks in, sees today, clocks out, and history is date-ordered", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(clockIn.status, 200);
  assert.equal(clockIn.body.data.clockOutAt, null);
  assert.equal(clockIn.body.data.source, "SELF");
  const recordId = clockIn.body.data.id;

  // Today's status reflects the open period.
  const today = await request(app)
    .get("/api/v1/attendance/today")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(today.status, 200);
  assert.equal(today.body.data.id, recordId);
  assert.equal(today.body.data.clockOutAt, null);

  // A second clock-in is blocked.
  const duplicate = await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "INVALID_CLOCK_ACTION");

  const clockOut = await request(app)
    .post("/api/v1/attendance/clock-out")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(clockOut.status, 200);
  assert.ok(clockOut.body.data.clockOutAt, "record closed");

  // Personal history contains the record.
  const me = await request(app)
    .get("/api/v1/attendance/me")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.total, 1);
  assert.equal(me.body.data.items[0].id, recordId);
});

test("F5: HR corrects a record with history + audit; self-correction is denied", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  const recordId = clockIn.body.data.id;
  const oldValue = clockIn.body.data.clockInAt;
  const newValue = new Date(new Date(oldValue).getTime() - 5 * 60 * 1000).toISOString();

  // An employee lacks attendance:correct, so the boundary blocks them (403).
  const employeeDenied = await request(app)
    .post(`/api/v1/attendance/${recordId}/correct`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ field: "clockInAt", oldValue, newValue, reason: "I made an error" });
  assert.equal(employeeDenied.status, 403);
  assert.equal(employeeDenied.body.error.code, "AUTH_DENIED");

  // A user WITH attendance:correct cannot correct their OWN record (409).
  await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  const today = await request(app)
    .get("/api/v1/attendance/today")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  const hrRecordId = today.body.data.id;
  const hrOwnDenied = await request(app)
    .post(`/api/v1/attendance/${hrRecordId}/correct`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ field: "clockInAt", oldValue: null, newValue: null, reason: "mine" });
  assert.equal(hrOwnDenied.status, 409);
  assert.equal(hrOwnDenied.body.error.code, "SELF_CORRECTION_DENIED");

  // HR corrects the employee's clock-in time.
  const corrected = await request(app)
    .post(`/api/v1/attendance/${recordId}/correct`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({
      field: "clockInAt",
      oldValue,
      newValue,
      reason: "Employee reported system delay at clock-in.",
    });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.data.field, "clockInAt");
  assert.equal(corrected.body.data.oldValue, oldValue);
  assert.equal(corrected.body.data.newValue, newValue);

  // The record detail exposes the correction history.
  const detail = await request(app)
    .get(`/api/v1/attendance/${recordId}`)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.corrections.length, 1);
  assert.equal(detail.body.data.corrections[0].reason, "Employee reported system delay at clock-in.");
  assert.equal(detail.body.data.source, "CORRECTION");

  // Audit trail records ATTENDANCE.CORRECTED.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "ATTENDANCE.CORRECTED", pageSize: 100 });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.total >= 1, "ATTENDANCE.CORRECTED in audit trail");
});

test("F6: HR overview filters records and respects scope", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const bob = await signIn("employee.bob", "Employee2026!");
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  const recordId = clockIn.body.data.id;
  await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${bob.accessToken}`);

  // HR sees all in-scope records.
  const overview = await request(app)
    .get("/api/v1/attendance")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(overview.status, 200);
  assert.equal(overview.body.data.total, 2);

  // Filter by employee.
  const byEmployee = await request(app)
    .get("/api/v1/attendance")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ employeeId: employee.user.id });
  assert.equal(byEmployee.body.data.total, 1);
  assert.equal(byEmployee.body.data.items[0].id, recordId);

  // A quick clock-out produces an ANOMALY; HR can filter on it.
  await request(app)
    .post("/api/v1/attendance/clock-out")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  const anomalies = await request(app)
    .get("/api/v1/attendance")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ exception: "ANOMALY" });
  assert.equal(anomalies.body.data.total, 1, "exception filter finds the ANOMALY record");

  // An employee without view_all cannot read the HR overview.
  const forbidden = await request(app)
    .get("/api/v1/attendance")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(forbidden.status, 403);

  // An employee cannot read another employee's record (404, no existence leak).
  const hidden = await request(app)
    .get(`/api/v1/attendance/${recordId}`)
    .set("Authorization", `Bearer ${bob.accessToken}`);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "ATTENDANCE_NOT_FOUND");
});
