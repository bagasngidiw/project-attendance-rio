/**
 * FR-008/FR-010 integration tests: the attachment surface lives under /api/v1
 * (upload/list/download/delete), validation rejects bad files, authorization
 * is enforced (403 at the boundary, 404 no-existence-leak in the service),
 * and eligible approvers of unclaimed role-targeted requests may view
 * attachments.
 *
 * Runs against the dedicated `attendance_attachment_test` database.
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
  process.env.MONGO_URI_ATTACHMENT_TEST || "mongodb://127.0.0.1:27017/attendance_attachment_test";

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

/** Submits a leave request for the employee (targetless, FR-007 default role). */
async function submitLeave(employee) {
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-10-01", endDate: "2026-10-02", reason: "Trip" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

test("FR-008: upload → list → download → delete round-trip over HTTP", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const req = await submitLeave(employee);

  // Upload (multipart field "file").
  const upload = await request(app)
    .post(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .attach("file", Buffer.from("%PDF-1.4 fake pdf content"), "supporting.pdf");
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const attachment = upload.body.data;
  assert.equal(attachment.originalName, "supporting.pdf");
  assert.equal(attachment.mimeType, "application/pdf");
  assert.equal(attachment.requestId, req.id);
  assert.ok(!("key" in attachment), "internal storage key never exposed");

  // List.
  const list = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(list.body.data.items[0].id, attachment.id);

  // Download returns the bytes.
  const download = await request(app)
    .get(`/api/v1/attachments/${attachment.id}/download`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers["content-type"], "application/pdf");
  assert.ok(download.body.includes(Buffer.from("%PDF-1.4 fake pdf content")));

  // The requester cannot DELETE (employee lacks files:delete -> 403 at gate).
  const employeeDelete = await request(app)
    .delete(`/api/v1/attachments/${attachment.id}`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(employeeDelete.status, 403);

  // HR can delete.
  const deleted = await request(app)
    .delete(`/api/v1/attachments/${attachment.id}`)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.data.deleted, true);

  // After delete the list is empty.
  const afterDelete = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(afterDelete.body.data.items.length, 0);
});

test("FR-008: disallowed file types are rejected with a clear validation error", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const req = await submitLeave(employee);

  const bad = await request(app)
    .post(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .attach("file", Buffer.from("#!/bin/sh rm -rf /"), "evil.sh");
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.equal(bad.body.error.code, "VALIDATION_ERROR");
});

test("FR-008: unauthenticated access is rejected", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const req = await submitLeave(employee);

  const anonymous = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`);
  assert.equal(anonymous.status, 401);
});

test("FR-010: an unrelated user gets 404 (no existence leak) on another request's attachments", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const other = await signIn("employee.bob", "Employee2026!");
  const req = await submitLeave(employee);

  await request(app)
    .post(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .attach("file", Buffer.from("data"), "note.pdf");

  const hidden = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${other.accessToken}`);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "REQUEST_NOT_FOUND");
});

test("FR-010: an eligible approver of an unclaimed role-targeted request can view attachments", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const req = await submitLeave(employee);

  // The request is role-targeted (FR-007) and NOT claimed yet.
  assert.equal(req.approval.targetType, "ROLE");
  assert.equal(req.approval.assignedUserId, null);

  await request(app)
    .post(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .attach("file", Buffer.from("payload"), "note.pdf");

  // The manager holds leave:approve and is an eligible approver -> allowed.
  const managerList = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(managerList.status, 200, JSON.stringify(managerList.body));
  assert.equal(managerList.body.data.items.length, 1);

  // An employee without approve power gets 404 even though they hold
  // files:download.
  const other = await signIn("employee.bob", "Employee2026!");
  const denied = await request(app)
    .get(`/api/v1/requests/${req.id}/attachments`)
    .set("Authorization", `Bearer ${other.accessToken}`);
  assert.equal(denied.status, 404);
});
