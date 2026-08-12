/**
 * FR-001 integration tests: approving a LEAVE request creates LEAVE attendance
 * records for every covered date, clock-in/out is blocked on approved leave
 * days, and rejected leave produces no attendance records.
 *
 * Runs against the dedicated `attendance_leave_test` database.
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
  process.env.MONGO_URI_ATTENDANCE_LEAVE_TEST || "mongodb://127.0.0.1:27017/attendance_attendance_leave_test";

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

/** UTC date key helper — the default company timezone offset is 0. */
function dateKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}

/** Submits (targetless), claims, and approves a leave for the employee. */
async function submitAndApproveLeave(employee, manager, { startDate, endDate }) {
  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate, endDate, reason: "Cuti" });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const requestId = sub.body.data.id;

  const claim = await request(app)
    .post(`/api/v1/requests/${requestId}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  const approved = await request(app)
    .post(`/api/v1/requests/${requestId}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "APPROVED");
  return requestId;
}

test("FR-001: approving leave creates LEAVE attendance records for every covered date", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const today = dateKey();
  const tomorrow = dateKey(1);

  await submitAndApproveLeave(employee, manager, { startDate: today, endDate: tomorrow });

  // Attendance history surfaces LEAVE rows for both covered dates.
  const me = await request(app)
    .get("/api/v1/attendance/me")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .query({ pageSize: 50 });
  assert.equal(me.status, 200);
  const leaveRows = me.body.data.items.filter((r) => r.status === "LEAVE");
  assert.ok(leaveRows.length >= 2, "LEAVE records created for covered dates");
  const covered = new Set([today, tomorrow]);
  assert.ok(
    leaveRows.every((r) => covered.has(r.date)),
    "only covered dates receive LEAVE records"
  );
});

test("FR-001: clock-in and clock-out are blocked on an approved-leave day", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const today = dateKey();

  await submitAndApproveLeave(employee, manager, { startDate: today, endDate: today });

  // getToday surfaces LEAVE.
  const todayRes = await request(app)
    .get("/api/v1/attendance/today")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(todayRes.status, 200);
  assert.equal(todayRes.body.data.status, "LEAVE");

  // Clock-in is rejected with the business error (before any verification).
  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({});
  assert.equal(clockIn.status, 409, JSON.stringify(clockIn.body));
  assert.equal(clockIn.body.error.code, "ON_APPROVED_LEAVE");

  // Clock-out is rejected too.
  const clockOut = await request(app)
    .post("/api/v1/attendance/clock-out")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({});
  assert.equal(clockOut.status, 409, JSON.stringify(clockOut.body));
  assert.equal(clockOut.body.error.code, "ON_APPROVED_LEAVE");
});

test("FR-001: rejected leave produces no attendance records", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const today = dateKey();

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: today, endDate: today, reason: "Cuti" });
  assert.equal(sub.status, 201);
  const requestId = sub.body.data.id;

  const claim = await request(app)
    .post(`/api/v1/requests/${requestId}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200);

  const rejected = await request(app)
    .post(`/api/v1/requests/${requestId}/reject`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ reason: "Tidak disetujui" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.data.status, "REJECTED");

  const me = await request(app)
    .get("/api/v1/attendance/me")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(me.body.data.total, 0, "no attendance records for rejected leave");
});

test("FR-001: an existing clocked record is never overwritten by leave sync", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const today = dateKey();

  // Employee clocks in first (today is NOT a leave day yet).
  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      location: { latitude: -6.2, longitude: 106.8, accuracy: 12, permissionState: "granted", acquisitionStatus: "found" },
      camera: { status: "captured", capturedAt: new Date().toISOString(), mediaRef: "/api/v1/attendance/media/test" },
      device: { category: "desktop", browser: "test", os: "test" },
    });
  assert.equal(clockIn.status, 200, JSON.stringify(clockIn.body));
  const recordId = clockIn.body.data.id;

  // Backdated leave approved TODAY covering today — sync must not overwrite.
  await submitAndApproveLeave(employee, manager, { startDate: today, endDate: today });

  const detail = await request(app)
    .get(`/api/v1/attendance/${recordId}`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.status, "NORMAL", "clocked record preserved");
  assert.ok(detail.body.data.clockInAt, "clock-in untouched");
});
