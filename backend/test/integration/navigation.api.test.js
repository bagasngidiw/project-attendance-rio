/**
 * FR-003/FR-004/FR-005 integration tests: the server-driven navigation tree
 * no longer exposes Organization / My Team / Audit Log / Activity Log menus,
 * and groups Leave / Permission / Sakit under a nested "Perijinan" group.
 *
 * Runs against the dedicated `attendance_navigation_test` database.
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
  process.env.MONGO_URI_NAVIGATION_TEST || "mongodb://127.0.0.1:27017/attendance_navigation_test";

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

/** Flattens the navigation tree into a plain label list. */
function flatten(nav, out = []) {
  for (const node of nav) {
    out.push(node.label);
    flatten(node.children ?? [], out);
  }
  return out;
}

/** Finds a node by id anywhere in the tree. */
function findNode(nav, id) {
  for (const node of nav) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

test("FR-003/FR-004: Organization, My Team, Audit Log, Activity Log are absent from /api/v1/navigation", async () => {
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const nav = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(nav.status, 200, JSON.stringify(nav.body));

  const labels = flatten(nav.body.data);
  assert.ok(!labels.includes("Organisasi"), "Organization menu removed");
  assert.ok(!labels.includes("Tim Saya"), "My Team menu removed");
  assert.ok(!labels.includes("Log Audit"), "Audit Log menu removed");
  assert.ok(!labels.includes("Log Aktivitas"), "Activity Log menu removed");
});

test("FR-005: /api/v1/navigation returns the nested Perijinan group with its three leaves", async () => {
  const employee = await signIn("employee", "Employee2026!");

  const nav = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(nav.status, 200, JSON.stringify(nav.body));

  const perijinan = findNode(nav.body.data, "nav.permissions");
  assert.ok(perijinan, "nested Perijinan group present");
  assert.equal(perijinan.path, null);
  assert.deepEqual(
    perijinan.children.map((c) => c.id).sort(),
    ["nav.leave", "nav.permission", "nav.sakit"]
  );
  assert.ok(findNode(nav.body.data, "nav.leave"), "Cuti leaf present");
  assert.ok(findNode(nav.body.data, "nav.permission"), "Ijin leaf present");
  assert.ok(findNode(nav.body.data, "nav.sakit"), "Sakit leaf present");

  // Routes are unchanged.
  assert.equal(findNode(nav.body.data, "nav.leave").path, "/leave");
  assert.equal(findNode(nav.body.data, "nav.permission").path, "/permission");
  assert.equal(findNode(nav.body.data, "nav.sakit").path, "/sakit");
});

test("FR-005: the nested group prunes when the user has none of its permissions", async () => {
  // A user with only dashboard access never sees Perijinan.
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");
  const hasher = new Hasher(4);
  await UserModel.create({
    username: "viewer",
    email: "viewer@corp.io",
    name: "Viewer",
    passwordHash: await hasher.hash("Viewer2026!"),
    status: "ACTIVE",
  });
  const { RoleModel } = require("../../src/infrastructure/models/role.model");
  const { RolePermissionModel } = require("../../src/infrastructure/models/role-permission.model");
  const role = await RoleModel.create({ key: "VIEWER", name: "Viewer", status: "ACTIVE", level: 5, dataScope: "SELF" });
  await RolePermissionModel.create({ roleId: role._id, permissionKey: "dashboard:view" });
  const { UserRoleModel } = require("../../src/infrastructure/models/user-role.model");
  await UserRoleModel.create({ userId: (await UserModel.findOne({ username: "viewer" }))._id, roleId: role._id });

  const viewer = await signIn("viewer", "Viewer2026!");
  const nav = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${viewer.accessToken}`);
  assert.equal(nav.status, 200, JSON.stringify(nav.body));
  assert.ok(!findNode(nav.body.data, "nav.permissions"), "nested group pruned when empty");
});
