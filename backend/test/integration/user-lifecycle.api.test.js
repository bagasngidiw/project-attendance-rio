/**
 * Integration tests for the Identity Administration Cluster (FR-029 / FR-028 /
 * FR-044): user lifecycle endpoints, password reset/change, and audit capture.
 *
 * Runs against the dedicated `attendance_test` database, dropped before each
 * test so the full stack (routes → middleware → services → MongoDB) is
 * exercised deterministically.
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

const TEST_URI = process.env.MONGO_URI_LIFECYCLE_TEST || "mongodb://127.0.0.1:27017/attendance_lifecycle_test";

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

test("F5: provisioned user signs in, changes password, then reaches protected access", async () => {
  const token = await adminToken();
  const roleId = await employeeRoleId();

  const created = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${token}`)
    .send({
      username: "newhire",
      email: "newhire@corp.io",
      name: "New Hire",
      roleIds: [roleId],
      initialPassword: "TempHire2026!x",
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.mustChangePassword, true, "provisioned user gated");

  // First sign-in with the temporary credential surfaces the gate.
  const first = await signIn("newhire", "TempHire2026!x");
  assert.equal(first.user.mustChangePassword, true);

  // Set a personal password (policy enforced).
  const changed = await request(app)
    .post("/api/v1/auth/change-password")
    .set("Authorization", `Bearer ${first.accessToken}`)
    .send({ currentPassword: "TempHire2026!x", newPassword: "Personal2026!x" });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.data, { success: true });

  // The pre-change access token was invalidated by the tokenVersion bump.
  const stale = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${first.accessToken}`);
  assert.equal(stale.status, 401, "old token rejected after password change");

  // A fresh sign-in clears the gate and grants protected access.
  const second = await signIn("newhire", "Personal2026!x");
  assert.equal(second.user.mustChangePassword, false);
  const nav = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${second.accessToken}`);
  assert.equal(nav.status, 200);
  assert.ok(nav.body.data.length >= 1, "protected access granted after password set");
});

test("F6: a deactivated user cannot sign in and their record is preserved", async () => {
  const token = await adminToken();
  const roleId = await employeeRoleId();

  const created = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${token}`)
    .send({
      username: "leaver",
      email: "leaver@corp.io",
      name: "Leaver",
      roleIds: [roleId],
      initialPassword: "TempLeaver2026!",
    });
  const userId = created.body.data.id;

  // Active sign-in works.
  const active = await signIn("leaver", "TempLeaver2026!");
  assert.equal(active.user.status, "ACTIVE");

  // Deactivate (data-preserving).
  const deactivated = await request(app)
    .post(`/api/v1/users/${userId}/deactivate`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.status, "INACTIVE");

  // Sign-in is blocked with a non-revealing inactive-account error.
  const blocked = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username: "leaver", password: "TempLeaver2026!" });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "AUTH_ACCOUNT_INACTIVE");

  // Historical record is preserved and still viewable by administrators.
  const view = await request(app)
    .get(`/api/v1/users/${userId}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.data.status, "INACTIVE");
  assert.equal(view.body.data.username, "leaver");

  // Re-activation restores sign-in.
  const reactivated = await request(app)
    .post(`/api/v1/users/${userId}/activate`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.body.data.status, "ACTIVE");
});

test("F7: admin reset invalidates sessions and forces a change at next sign-in", async () => {
  const token = await adminToken();
  const roleId = await employeeRoleId();

  const created = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${token}`)
    .send({
      username: "resetuser",
      email: "resetuser@corp.io",
      name: "Reset User",
      roleIds: [roleId],
      initialPassword: "TempReset2026!",
    });
  const userId = created.body.data.id;

  const session = await signIn("resetuser", "TempReset2026!");

  const reset = await request(app)
    .post(`/api/v1/users/${userId}/reset-password`)
    .set("Authorization", `Bearer ${token}`)
    .send({ initialPassword: "NewTemp2026!x" });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.mustChangePassword, true);

  // Existing access token is dead after the reset.
  const stale = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${session.accessToken}`);
  assert.equal(stale.status, 401, "sessions invalidated by reset");

  // Next sign-in uses the temporary credential and is gated.
  const after = await signIn("resetuser", "NewTemp2026!x");
  assert.equal(after.user.mustChangePassword, true, "user must change at next sign-in");
});

test("F8: lifecycle and credential actions are recorded in the audit trail", async () => {
  const token = await adminToken();
  const roleId = await employeeRoleId();

  // Create
  const created = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${token}`)
    .send({
      username: "audited",
      email: "audited@corp.io",
      name: "Audited",
      roleIds: [roleId],
      initialPassword: "TempAudit2026!",
    });
  assert.equal(created.status, 201);
  const userId = created.body.data.id;

  // Update
  await request(app)
    .put(`/api/v1/users/${userId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Audited Renamed" });

  // Deactivate + activate
  await request(app)
    .post(`/api/v1/users/${userId}/deactivate`)
    .set("Authorization", `Bearer ${token}`);
  await request(app)
    .post(`/api/v1/users/${userId}/activate`)
    .set("Authorization", `Bearer ${token}`);

  // Reset
  await request(app)
    .post(`/api/v1/users/${userId}/reset-password`)
    .set("Authorization", `Bearer ${token}`)
    .send({ initialPassword: "TempAudit2_2026!" });

  // Self password change
  const user = await signIn("audited", "TempAudit2_2026!");
  await request(app)
    .post("/api/v1/auth/change-password")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({ currentPassword: "TempAudit2_2026!", newPassword: "AuditFinal2026!" });

  // Super admin reads the audit trail and sees every USER.* + AUTH.PASSWORD_CHANGED.
  const events = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${token}`)
    .query({ subjectType: "USER", pageSize: 100 });

  assert.equal(events.status, 200);
  const actions = events.body.data.items.map((e) => e.action);
  for (const expected of [
    "USER.CREATED",
    "USER.UPDATED",
    "USER.DEACTIVATED",
    "USER.ACTIVATED",
    "USER.PASSWORD_RESET",
  ]) {
    assert.ok(actions.includes(expected), `missing audit event ${expected}`);
  }

  // AUTH.PASSWORD_CHANGED is carried on both surfaces (audit + activity).
  assert.ok(
    actions.includes("AUTH.PASSWORD_CHANGED"),
    "AUTH.PASSWORD_CHANGED recorded"
  );
  const activity = await request(app)
    .get("/api/v1/activity/records")
    .set("Authorization", `Bearer ${token}`)
    .query({ action: "AUTH.PASSWORD_CHANGED", pageSize: 100 });
  assert.equal(activity.status, 200);
  assert.ok(activity.body.data.total >= 1, "password change also logged as activity");
});
