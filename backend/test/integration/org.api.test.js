/**
 * Integration tests for Organizational Structure & Manager Capabilities
 * (FR-024 / FR-043 / FR-006): org CRUD with deactivation, reporting-line
 * assignment affecting team scope, and audit/history recording.
 *
 * Runs against the dedicated `attendance_org_test` database.
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
  process.env.MONGO_URI_ORG_TEST || "mongodb://127.0.0.1:27017/attendance_org_test";

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

async function employeeRoleId() {
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const role = await RoleModel.findOne({ key: "EMPLOYEE" });
  return role.id.toString();
}

test("F4: departments are created, listed, deactivated (history preserved), and block new assignment", async () => {
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const created = await request(app)
    .post("/api/v1/org/departments")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ name: "Engineering", code: "ENG", description: "Software" });
  assert.equal(created.status, 201);
  const deptId = created.body.data.id;

  // Active picker includes it.
  const active = await request(app)
    .get("/api/v1/org/departments/active")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.ok(active.body.data.items.some((d) => d.id === deptId));

  // Deactivate → hidden from active picker but still in the full list.
  const deactivated = await request(app)
    .post(`/api/v1/org/departments/${deptId}/deactivate`)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(deactivated.body.data.status, "INACTIVE");

  const activeAfter = await request(app)
    .get("/api/v1/org/departments/active")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.ok(!activeAfter.body.data.items.some((d) => d.id === deptId), "hidden from pickers");

  const all = await request(app)
    .get("/api/v1/org/departments")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.ok(all.body.data.items.some((d) => d.id === deptId), "history preserved");

  // Assigning a user to the deactivated department is blocked.
  const roleId = await employeeRoleId();
  const blocked = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({
      username: "orgblocked",
      email: "orgblocked@corp.io",
      name: "Org Blocked",
      roleIds: [roleId],
      departmentId: deptId,
      initialPassword: "OrgBlock2026!",
    });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "ORG_INACTIVE");
});

test("F5: assigning a manager reflects in the team overview; out-of-scope member is 404", async () => {
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const manager = await signIn("manager", "Manager2026!");

  // Create a fresh employee with no manager.
  const roleId = await employeeRoleId();
  const created = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({
      username: "newhire_org",
      email: "newhire_org@corp.io",
      name: "New Hire",
      roleIds: [roleId],
      initialPassword: "NewHireOrg2026!",
    });
  assert.equal(created.status, 201);
  const userId = created.body.data.id;

  // Assign the demo manager as their manager.
  const assigned = await request(app)
    .put(`/api/v1/reporting/users/${userId}/manager`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ managerId: manager.user.id });
  assert.equal(assigned.status, 200);
  assert.equal(String(assigned.body.data.managerId), String(manager.user.id));

  // The manager's team overview now includes them.
  const team = await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(team.status, 200);
  assert.ok(
    team.body.data.members.some((m) => String(m.id) === userId),
    "new member appears in team overview"
  );

  // Out-of-scope member (the manager themselves) → 404, no existence leak.
  const hidden = await request(app)
    .get(`/api/v1/manager/team/${manager.user.id}`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(hidden.status, 404);
});

test("F6: manager reassignment is recorded in history and the audit trail", async () => {
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");
  const hasher = new Hasher(4);
  const target = await UserModel.create({
    username: "reportline",
    email: "reportline@corp.io",
    name: "Report Line",
    passwordHash: await hasher.hash("Report2026!"),
    status: "ACTIVE",
  });
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const employeeRole = await RoleModel.findOne({ key: "EMPLOYEE" });
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  await UserRoleModel.create({ userId: target.id, roleId: employeeRole.id });

  // Assign manager.
  await request(app)
    .put(`/api/v1/reporting/users/${target.id}/manager`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ managerId: hr.user.id });

  // Reassign to the demo manager.
  const managerSession = await signIn("manager", "Manager2026!");
  await request(app)
    .put(`/api/v1/reporting/users/${target.id}/manager`)
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .send({ managerId: managerSession.user.id });

  // History shows both changes.
  const history = await request(app)
    .get(`/api/v1/reporting/users/${target.id}/manager-history`)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(history.status, 200);
  assert.equal(history.body.data.items.length, 2);
  assert.equal(String(history.body.data.items[1].newManagerId), String(managerSession.user.id));

  // Audit trail records REPORTING.MANAGER_ASSIGNED.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "REPORTING.MANAGER_ASSIGNED", pageSize: 100 });
  assert.ok(audit.body.data.total >= 2, "manager assignments audited");
});
