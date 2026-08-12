/**
 * Integration tests for the auth + RBAC API surface (design §5.1).
 *
 * These run against a dedicated test database (`attendance_test`) that is
 * dropped before each run, so they exercise the full stack: Express routes,
 * middleware chain, repositories and MongoDB.
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

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/attendance_test";

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

/** Flattens the grouped navigation tree into a plain label list. */
function flattenNav(nodes) {
  const out = [];
  for (const node of nodes ?? []) {
    out.push(node.label);
    out.push(...flattenNav(node.children ?? []));
  }
  return out;
}

test("GET /health returns ok", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { status: "ok" });
});

test("POST /auth/signin succeeds for bootstrap super admin", async () => {
  const data = await signIn("superadmin", createConfig().seed.superAdminPassword);
  assert.ok(data.accessToken);
  assert.ok(data.refreshToken);
  assert.ok(data.sessionId);
  assert.equal(data.user.username, "superadmin");
  assert.deepEqual(data.user.roles, ["SUPER_ADMIN"]);
  assert.ok(data.permissions.includes("rbac:manage_roles"));
});

test("POST /auth/signin returns identical error for bad user and bad password", async () => {
  const badUser = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username: "nobody", password: "Whatever123!" });
  const badPass = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username: "superadmin", password: "WrongPassword!" });
  assert.equal(badUser.status, 401);
  assert.equal(badPass.status, 401);
  assert.deepEqual(badUser.body.error.code, badPass.body.error.code);
  assert.deepEqual(badUser.body.error.message, badPass.body.error.message);
});

test("POST /auth/signin validates input (short password → 400)", async () => {
  const res = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username: "superadmin", password: "short" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
});

test("POST /auth/refresh rotates tokens", async () => {
  const { refreshToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const rotated = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.body.data.accessToken);

  const reuse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken });
  assert.equal(reuse.status, 401);
});

test("GET /auth/session returns identity for valid token", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/auth/session")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.username, "superadmin");
  assert.ok(res.body.data.permissions.includes("dashboard:view"));
});

test("GET /auth/session rejects missing token", async () => {
  const res = await request(app).get("/api/v1/auth/session");
  assert.equal(res.status, 401);
});

test("POST /auth/signout revokes the session", async () => {
  const { refreshToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const out = await request(app).post("/api/v1/auth/signout").send({ refreshToken });
  assert.equal(out.status, 204);

  const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
  assert.equal(reuse.status, 401);
});

test("protected endpoints fail closed when the session record is missing", async () => {
  const { SessionModel } = require("../../src/infrastructure/models/session.model");

  const { accessToken, sessionId } = await signIn("superadmin", createConfig().seed.superAdminPassword);

  // Simulate a session that no longer exists (TTL cleanup / DB reset).
  await SessionModel.deleteOne({ sessionId });

  const res = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "AUTH_TOKEN_INVALID");
});

test("GET /users/me returns current user profile + permissions", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/users/me")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.username, "superadmin");
  assert.ok(res.body.data.permissions.length > 0);
});

test("GET /rbac/roles requires rbac:view_roles permission", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  const keys = res.body.data.map((r) => r.key);
  assert.deepEqual(keys, ["EMPLOYEE", "HR_ADMIN", "MANAGER", "SUPER_ADMIN"]);
});

test("GET /rbac/permissions returns grouped registry", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/rbac/permissions")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  const modules = res.body.data.map((m) => m.module);
  assert.ok(modules.includes("ATTENDANCE"));
});

test("RBAC endpoints deny access without permission (403)", async () => {
  // Create an EMPLOYEE user and sign in as them.
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const user = await UserModel.create({
    username: "emp",
    email: "emp@corp.io",
    name: "Emp",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: user.id, roleId: role.id });

  const { accessToken } = await signIn("emp", "Employee123!");

  const res = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_DENIED");
});

test("PUT /rbac/users/:id/roles assigns roles and bumps tokenVersion", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const target = await UserModel.create({
    username: "target",
    email: "target@corp.io",
    name: "Target",
    passwordHash: await hasher.hash("Target123!"),
    status: "ACTIVE",
  });
  const managerRole = await RoleModel.findOne({ key: "MANAGER" });

  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .put(`/api/v1/rbac/users/${target.id}/roles`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ roleIds: [managerRole.id.toString()] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.roles, ["MANAGER"]);
});

test("unknown route returns 404 with envelope", async () => {
  const res = await request(app).get("/api/v1/does-not-exist");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "NOT_FOUND");
});

test("security headers are applied", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
});

/* ---------------------------------------------------------------------------
 * FR-003 / FR-004 / FR-005 — RBAC Enforcement Triad
 * ------------------------------------------------------------------------- */

test("GET /navigation returns filtered tree for an employee", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "empnav",
    email: "empnav@corp.io",
    name: "Emp Nav",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const { accessToken } = await signIn("empnav", "Employee123!");
  const res = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  // Navigation is grouped; collect labels across groups + children.
  const labels = flattenNav(res.body.data);
  assert.ok(labels.includes("Dasbor"));
  assert.ok(labels.includes("Cuti"));
  assert.ok(!labels.includes("Pengguna"), "employee must not see Users");
  assert.ok(!labels.includes("Laporan"), "employee must not see Reports");
  assert.ok(!labels.includes("Peran & Izin"));
});

test("GET /navigation returns full tree for super admin", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  const labels = flattenNav(res.body.data);
  for (const expected of ["Dasbor", "Pengguna", "Laporan", "Peran & Izin", "Profil"]) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
});

test("GET /navigation requires authentication", async () => {
  const res = await request(app).get("/api/v1/navigation");
  assert.equal(res.status, 401);
});

test("POST /access/check evaluates requested permissions for current user", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "empcheck",
    email: "empcheck@corp.io",
    name: "Emp Check",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const { accessToken } = await signIn("empcheck", "Employee123!");
  const res = await request(app)
    .post("/api/v1/access/check")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ keys: ["leave:submit", "leave:approve", "users:create"] });

  assert.equal(res.status, 200);
  const byKey = Object.fromEntries(res.body.data.map((r) => [r.key, r.granted]));
  assert.equal(byKey["leave:submit"], true);
  assert.equal(byKey["leave:approve"], false);
  assert.equal(byKey["users:create"], false);
});

test("POST /access/check validates the body", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .post("/api/v1/access/check")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ keys: [] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
});

test("authorize denial returns AUTH_DENIED with permissionKey", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "empdeny",
    email: "empdeny@corp.io",
    name: "Emp Deny",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const { accessToken } = await signIn("empdeny", "Employee123!");
  const res = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_DENIED");
  assert.equal(res.body.error.permissionKey, "rbac:view_roles");
});

test("D5: direct-request denial is recorded as AUTH.DENIED in the audit trail", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "empdenyaudit",
    email: "empdenyaudit@corp.io",
    name: "Emp Deny Audit",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const employee = await signIn("empdenyaudit", "Employee123!");

  // Direct request to an admin-only surface is denied and changes nothing.
  const denied = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "AUTH_DENIED");

  // The denial must be recorded in the audit trail (FR-005 / §5.3).
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "AUTH.DENIED", actorId: emp.id.toString() });

  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.total >= 1, "expected an AUTH.DENIED audit event");
  const event = audit.body.data.items.find(
    (e) => String(e.actor.userId) === emp.id.toString() && e.outcome === "DENIED"
  );
  assert.ok(event, "AUTH.DENIED event must carry outcome DENIED");
  assert.ok(
    String(event.subject.id).includes("/rbac/roles"),
    "denial subject identifies the attempted route"
  );
  assert.equal(event.subject.summary, "rbac:view_roles");
});

test("D6: role reassignment bumps tokenVersion; old token rejected; navigation reflects new roles", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const target = await UserModel.create({
    username: "targetnav",
    email: "targetnav@corp.io",
    name: "Target Nav",
    passwordHash: await hasher.hash("Target123!"),
    status: "ACTIVE",
  });
  const employeeRole = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: target.id, roleId: employeeRole.id });

  // Baseline: as EMPLOYEE the nav tree has no My Team node.
  const before = await signIn("targetnav", "Target123!");
  const navBefore = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${before.accessToken}`);
  assert.equal(navBefore.status, 200);
  const labelsBefore = navBefore.body.data.map((n) => n.label);
  assert.ok(!labelsBefore.includes("Tim Saya"), "employee must not see My Team");

  // Super admin promotes the target to MANAGER (role set replaced + tokenVersion bump).
  const managerRole = await RoleModel.findOne({ key: "MANAGER" });
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const assigned = await request(app)
    .put(`/api/v1/rbac/users/${target.id}/roles`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ roleIds: [managerRole.id.toString()] });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.data.roles, ["MANAGER"]);

  // The pre-promotion token is superseded and must fail closed at the boundary.
  const stale = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${before.accessToken}`);
  assert.equal(stale.status, 401, "old token must be rejected after role change");

  // A fresh sign-in reflects the new effective permissions in the nav tree.
  const after = await signIn("targetnav", "Target123!");
  const navAfter = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${after.accessToken}`);
  assert.equal(navAfter.status, 200);
  const labelsAfter = flattenNav(navAfter.body.data);
  // FR-003: the manager no longer sees My Team (menu removed), but the new
  // approve permissions surface the PERSETUJUAN group.
  assert.ok(!labelsAfter.includes("Tim Saya"), "My Team menu removed");
  assert.ok(labelsAfter.includes("Persetujuan"), "manager must see Approvals");
});

test("F7: a BOTH-surface event writes an audit entry and activity twin sharing correlationId", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const target = await UserModel.create({
    username: "trace_target",
    email: "trace_target@corp.io",
    name: "Trace Target",
    passwordHash: await hasher.hash("Target123!"),
    status: "ACTIVE",
  });
  const employeeRole = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: target.id, roleId: employeeRole.id });

  const correlationId = "corr_traceability_f7";

  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const managerRole = await RoleModel.findOne({ key: "MANAGER" });
  const assigned = await request(app)
    .put(`/api/v1/rbac/users/${target.id}/roles`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .set("x-correlation-id", correlationId)
    .send({ roleIds: [managerRole.id.toString()] });
  assert.equal(assigned.status, 200);

  // RBAC.ROLES_ASSIGNED is a BOTH-surface event: it must land on the audit
  // surface AND on the activity surface, linked by the same correlation id
  // so a single request is traceable end-to-end (FR-012/FR-013 §7).
  const auditEvents = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "RBAC.ROLES_ASSIGNED", correlationId });

  assert.equal(auditEvents.status, 200);
  assert.equal(auditEvents.body.data.total, 1, "one audit event for the assignment");
  const auditEvent = auditEvents.body.data.items[0];
  assert.equal(auditEvent.correlationId, correlationId);
  assert.equal(String(auditEvent.subject.id), target.id.toString());
  assert.equal(String(auditEvent.actor.userId), admin.user.id.toString());
  assert.equal(auditEvent.outcome, "SUCCESS");

  const activityRecords = await request(app)
    .get("/api/v1/activity/records")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "RBAC.ROLES_ASSIGNED", correlationId });

  assert.equal(activityRecords.status, 200);
  assert.equal(activityRecords.body.data.total, 1, "one activity twin for the assignment");
  const twin = activityRecords.body.data.items[0];
  assert.equal(
    twin.correlationId,
    correlationId,
    "audit event + activity twin share the same correlation id"
  );
  assert.equal(String(twin.subject.id), target.id.toString());
  assert.equal(String(twin.actor.userId), admin.user.id.toString());
});

test("G3: HR_ADMIN audit scope is restricted to their own actions", async () => {
  // Super admin acts first — these events must stay invisible to the HR admin.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  // HR admin signs in; their own sign-in success is an audit event.
  const hr = await signIn("hradmin", "HrAdmin2026!");
  assert.ok(hr.user.roles.includes("HR_ADMIN"));

  const res = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${hr.accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.total >= 1, "HR admin sees their own audit events");
  const seenActorIds = res.body.data.items.map((e) => String(e.actor.userId));
  assert.ok(
    seenActorIds.every((id) => id === hr.user.id.toString()),
    "non-SUPER_ADMIN viewer only sees their own actions"
  );
  assert.ok(
    !seenActorIds.includes(admin.user.id.toString()),
    "super admin events are hidden from the HR admin scope"
  );
});

/* ---------------------------------------------------------------------------
 * FR-012 / FR-013 — Audit & Activity Logging
 * ------------------------------------------------------------------------- */

test("GET /audit/events requires audit:view (employee denied)", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "empaudit",
    email: "empaudit@corp.io",
    name: "Emp Audit",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const { accessToken } = await signIn("empaudit", "Employee123!");
  const res = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(res.status, 403);
});

test("GET /audit/events returns paginated audit events for super admin", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/audit/events?page=1&pageSize=10")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.total >= 0);
  assert.equal(res.body.data.items.length <= 10, true);
});

test("GET /audit/events supports action filter", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/audit/events?action=AUTH.SIGNIN_SUCCESS")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.items.every((e) => e.action === "AUTH.SIGNIN_SUCCESS"));
});

test("GET /audit/verify reports chain health", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/audit/verify")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.valid, true);
  assert.equal(res.body.data.count >= 0, true);
});

test("GET /activity/records requires audit:view and returns records", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/activity/records")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
});

test("GET /audit/export returns CSV", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/audit/export")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/csv/);
  assert.match(res.text, /recordedAt/);
  assert.match(res.text, /action/);
});

test("audit events are hash-chained in the database", async () => {
  const { AuditEventModel } = require("../../src/infrastructure/models/audit-event.model");

  // Sign-in emits AUTH.SIGNIN_SUCCESS events.
  await signIn("superadmin", createConfig().seed.superAdminPassword);
  await signIn("superadmin", createConfig().seed.superAdminPassword);

  const events = await AuditEventModel.find()
    .sort({ recordedAt: 1, _id: 1 })
    .lean();
  const signin = events.filter((e) => e.action === "AUTH.SIGNIN_SUCCESS");
  assert.ok(signin.length >= 1);
  for (let i = 0; i < signin.length; i++) {
    if (i > 0) {
      assert.equal(signin[i].prevHash, signin[i - 1].hash);
    }
  }
  assert.ok(signin.every((e) => e.hash && e.hash.length === 64));
});

/* ---------------------------------------------------------------------------
 * FR-011 — Role & Permission Configuration Console
 * ------------------------------------------------------------------------- */

test("GET /rbac/admin/matrix returns permission matrix for super admin", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/rbac/admin/matrix")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  const modules = res.body.data.map((m) => m.module);
  assert.ok(modules.includes("ATTENDANCE"));
});

test("POST /rbac/admin/roles creates a role (super admin only)", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      name: "Payroll Specialist",
      description: "Reviews payroll",
      permissions: ["reporting:view", "reporting:export_excel"],
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.key, "PAYROLL_SPECIALIST");
  assert.equal(res.body.data.isSystem, false);
  assert.deepEqual(res.body.data.permissions, ["reporting:export_excel", "reporting:view"]);
});

test("POST /rbac/admin/roles rejects duplicates with 409", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const body = {
    name: "Duplicate Role",
    permissions: ["dashboard:view"],
  };
  const first = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(body);
  assert.equal(first.status, 201);

  const second = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(body);
  assert.equal(second.status, 409);
});

test("PATCH /rbac/admin/roles/:id/permissions applies diff and reports affected users", async () => {
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);

  const created = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Temp Role", permissions: ["dashboard:view"] });
  const roleId = created.body.data.id;

  const res = await request(app)
    .patch(`/api/v1/rbac/admin/roles/${roleId}/permissions`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      permissions: ["dashboard:view", "reporting:view"],
      reason: "needs reports",
      expectedVersion: 1,
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.permissions, ["dashboard:view", "reporting:view"]);
  assert.equal(typeof res.body.data.affectedUsers, "number");
});

test("PATCH permissions on SUPER_ADMIN cannot remove platform perms (409)", async () => {
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const superRole = await RoleModel.findOne({ key: "SUPER_ADMIN" });

  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .patch(`/api/v1/rbac/admin/roles/${superRole.id}/permissions`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      permissions: ["dashboard:view"],
      expectedVersion: superRole.version,
    });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "SUPER_ADMIN_GUARD");
});

test("POST /rbac/admin/roles/:id/disable is blocked for system roles (409)", async () => {
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const employeeRole = await RoleModel.findOne({ key: "EMPLOYEE" });

  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .post(`/api/v1/rbac/admin/roles/${employeeRole.id}/disable`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ expectedVersion: employeeRole.version });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "SYSTEM_ROLE_PROTECTED");
});

test("GET /rbac/admin/users/:id/effective-permissions returns breakdown", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const emp = await UserModel.create({
    username: "rbacviewer",
    email: "rbacviewer@corp.io",
    name: "RBAC Viewer",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: emp.id, roleId: role.id });

  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get(`/api/v1/rbac/admin/users/${emp.id}/effective-permissions`)
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.username, "rbacviewer");
  assert.ok(res.body.data.permissions.includes("dashboard:view"));
  assert.equal(res.body.data.breakdown.length, 1);
  assert.equal(res.body.data.breakdown[0].roleKey, "EMPLOYEE");
});

test("malformed :id path params return 404 instead of leaking a 500", async () => {
  // Regression for the CastError surfaced in the server log when a user id
  // that is not a valid ObjectId is passed to the effective-permissions route.
  const { accessToken } = await signIn("superadmin", createConfig().seed.superAdminPassword);

  const effPerms = await request(app)
    .get("/api/v1/rbac/admin/users/6a7393%E2%80%A6d671/effective-permissions")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(effPerms.status, 404);
  assert.equal(effPerms.body.error.code, "NOT_FOUND");

  const role = await request(app)
    .get("/api/v1/rbac/roles/not-an-object-id")
    .set("Authorization", `Bearer ${accessToken}`);
  assert.equal(role.status, 404);
  assert.equal(role.body.error.code, "NOT_FOUND");
});

test("RBAC admin write endpoints are denied for HR admin without manage permissions", async () => {
  const { accessToken } = await signIn("hradmin", "HrAdmin2026!");
  const res = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Nope", permissions: ["dashboard:view"] });

  assert.equal(res.status, 403);
});

/* ---------------------------------------------------------------------------
 * FR-011 — Console end-to-end flows (create -> assign -> enforce -> audit)
 * ------------------------------------------------------------------------- */

test("F5: a newly created role flows to the user's navigation and API after assignment", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const user = await UserModel.create({
    username: "roleflow",
    email: "roleflow@corp.io",
    name: "Role Flow",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });

  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  // Create a brand-new role through the console.
  const created = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ name: "Report Viewer", permissions: ["reporting:view"] });
  assert.equal(created.status, 201);
  const roleId = created.body.data.id;

  // Assign it to the user (replaces their empty role set).
  const assigned = await request(app)
    .put(`/api/v1/rbac/users/${user.id}/roles`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ roleIds: [roleId] });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.data.roles, ["REPORT_VIEWER"]);

  // A fresh sign-in reflects the new permissions in navigation and API.
  const member = await signIn("roleflow", "Employee123!");
  const nav = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${member.accessToken}`);
  assert.equal(nav.status, 200);
  const labels = flattenNav(nav.body.data);
  assert.ok(labels.includes("Laporan"), "new role grants Reports navigation");
  assert.ok(!labels.includes("Pengguna"), "no users:view -> no Users navigation");

  const check = await request(app)
    .post("/api/v1/access/check")
    .set("Authorization", `Bearer ${member.accessToken}`)
    .send({ keys: ["reporting:view", "reporting:export_pdf", "users:create"] });
  assert.equal(check.status, 200);
  const byKey = Object.fromEntries(check.body.data.map((r) => [r.key, r.granted]));
  assert.equal(byKey["reporting:view"], true);
  assert.equal(byKey["reporting:export_pdf"], false);
  assert.equal(byKey["users:create"], false);
});

test("F6: permission change invalidates role holders (old token rejected)", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");

  const hasher = new Hasher(4);
  const user = await UserModel.create({
    username: "permflow",
    email: "permflow@corp.io",
    name: "Perm Flow",
    passwordHash: await hasher.hash("Employee123!"),
    status: "ACTIVE",
  });
  const employeeRole = await RoleModel.findOne({ key: "EMPLOYEE" });
  await UserRoleModel.create({ userId: user.id, roleId: employeeRole.id });

  // Baseline: EMPLOYEE grants attendance:clock_in.
  const before = await signIn("permflow", "Employee123!");
  const baseline = await request(app)
    .post("/api/v1/access/check")
    .set("Authorization", `Bearer ${before.accessToken}`)
    .send({ keys: ["attendance:clock_in"] });
  const baselineMap = Object.fromEntries(baseline.body.data.map((r) => [r.key, r.granted]));
  assert.equal(baselineMap["attendance:clock_in"], true);

  // Super admin removes attendance:clock_in from the EMPLOYEE role.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const rolesRes = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  const employeeDto = rolesRes.body.data.find((r) => r.key === "EMPLOYEE");
  const nextPermissions = employeeDto.permissions.filter(
    (k) => k !== "attendance:clock_in"
  );

  const patched = await request(app)
    .patch(`/api/v1/rbac/admin/roles/${employeeDto.id}/permissions`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      permissions: nextPermissions,
      reason: "policy change",
      expectedVersion: employeeDto.version,
    });
  assert.equal(patched.status, 200);
  assert.ok(patched.body.data.affectedUsers >= 1, "holder tokenVersion must be bumped");

  // The pre-change token is now superseded and rejected at the boundary.
  const stale = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${before.accessToken}`);
  assert.equal(stale.status, 401, "old token rejected after permission change");

  // A fresh sign-in reflects the narrowed permissions.
  const after = await signIn("permflow", "Employee123!");
  const check = await request(app)
    .post("/api/v1/access/check")
    .set("Authorization", `Bearer ${after.accessToken}`)
    .send({ keys: ["attendance:clock_in", "attendance:view_own"] });
  const afterMap = Object.fromEntries(check.body.data.map((r) => [r.key, r.granted]));
  assert.equal(afterMap["attendance:clock_in"], false, "clock_in removed by policy change");
  assert.equal(afterMap["attendance:view_own"], true, "view_own retained");
});

test("F8: every RBAC console mutation is recorded as an RBAC.* audit event", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  const getRoleVersion = async (roleId) => {
    const res = await request(app)
      .get(`/api/v1/rbac/admin/roles/${roleId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    assert.equal(res.status, 200);
    return res.body.data.version;
  };

  // Create -> RBAC.ROLE_CREATED
  const created = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ name: "Audit Tracker", permissions: ["dashboard:view"] });
  assert.equal(created.status, 201);
  const roleId = created.body.data.id;

  // Update -> RBAC.ROLE_UPDATED
  const updated = await request(app)
    .put(`/api/v1/rbac/admin/roles/${roleId}`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ name: "Audit Tracker Renamed", expectedVersion: await getRoleVersion(roleId) });
  assert.equal(updated.status, 200);

  // Set permissions -> RBAC.PERMISSION_CHANGED (with diff + reason metadata)
  const patched = await request(app)
    .patch(`/api/v1/rbac/admin/roles/${roleId}/permissions`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      permissions: ["dashboard:view", "reporting:view"],
      reason: "expand scope",
      expectedVersion: await getRoleVersion(roleId),
    });
  assert.equal(patched.status, 200);

  // Disable + enable -> RBAC.ROLE_DISABLED / RBAC.ROLE_ENABLED
  const disabled = await request(app)
    .post(`/api/v1/rbac/admin/roles/${roleId}/disable`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ expectedVersion: await getRoleVersion(roleId) });
  assert.equal(disabled.status, 200);

  const enabled = await request(app)
    .post(`/api/v1/rbac/admin/roles/${roleId}/enable`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ expectedVersion: await getRoleVersion(roleId) });
  assert.equal(enabled.status, 200);

  // Every mutation must be recorded with actor + metadata in the audit trail.
  const events = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ actorId: admin.user.id.toString(), pageSize: 100 });

  assert.equal(events.status, 200);
  const actions = events.body.data.items.map((e) => e.action);
  for (const expected of [
    "RBAC.ROLE_CREATED",
    "RBAC.ROLE_UPDATED",
    "RBAC.PERMISSION_CHANGED",
    "RBAC.ROLE_DISABLED",
    "RBAC.ROLE_ENABLED",
  ]) {
    assert.ok(actions.includes(expected), `missing audit event ${expected}`);
  }

  const permChanged = events.body.data.items.find(
    (e) => e.action === "RBAC.PERMISSION_CHANGED"
  );
  assert.equal(permChanged.metadata.reason, "expand scope");
  assert.deepEqual(permChanged.metadata.added, ["reporting:view"]);
  assert.deepEqual(permChanged.metadata.removed, []);
  assert.equal(String(permChanged.actor.userId), admin.user.id.toString());
});
