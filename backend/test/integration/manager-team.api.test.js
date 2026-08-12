/**
 * Integration tests for the FR-006 manager team overview API.
 *
 * These run against a dedicated test database (`attendance_team_test`) that is
 * dropped before each run, exercising the full stack: Express routes,
 * middleware chain (authenticate + authorize), repositories and MongoDB.
 *
 * NOTE: uses its own database so it can run in parallel with the other
 * integration suites (node --test runs files concurrently).
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
  process.env.MONGO_URI_TEAM_TEST || "mongodb://127.0.0.1:27017/attendance_team_test";

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

test("GET /manager/team returns the demo manager's direct reports", async () => {
  const { accessToken } = await signIn("manager", "Manager2026!");

  const res = await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.manager.username, "manager");
  assert.equal(data.memberCount, 3);
  const usernames = data.members.map((m) => m.username).sort();
  assert.deepEqual(usernames, ["employee", "employee.ana", "employee.bob"]);
  assert.ok(
    data.members.every((m) => m.roles.includes("EMPLOYEE")),
    "each team member carries their role keys"
  );
});

test("GET /manager/team returns a stable pending summary shape", async () => {
  const { accessToken } = await signIn("manager", "Manager2026!");

  const res = await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.pendingSummary, {
    attendance: 0,
    leave: 0,
    overtime: 0,
    trip: 0,
    permission: 0,
    sakit: 0,
  });
});

test("GET /manager/team/:memberId returns a scoped team member", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const member = await UserModel.findOne({ username: "employee" });

  const { accessToken } = await signIn("manager", "Manager2026!");
  const res = await request(app)
    .get(`/api/v1/manager/team/${member.id}`)
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.username, "employee");
  assert.deepEqual(res.body.data.roles, ["EMPLOYEE"]);
});

test("GET /manager/team/:memberId hides out-of-scope members (404, no leak)", async () => {
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const outside = await UserModel.findOne({ username: "hradmin" });

  const { accessToken } = await signIn("manager", "Manager2026!");
  const res = await request(app)
    .get(`/api/v1/manager/team/${outside.id}`)
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "TEAM_MEMBER_NOT_FOUND");
});

test("GET /manager/team is denied for employees (403 AUTH_DENIED)", async () => {
  const { accessToken } = await signIn("employee", "Employee2026!");

  const res = await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_DENIED");
  assert.equal(res.body.error.permissionKey, "team:view_team");
});

test("GET /manager/team requires authentication", async () => {
  const res = await request(app).get("/api/v1/manager/team");
  assert.equal(res.status, 401);
});

test("manager navigation no longer includes My Team (FR-003 menu removal)", async () => {
  const { accessToken } = await signIn("manager", "Manager2026!");

  const res = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  const labels = flattenNav(res.body.data);
  assert.ok(!labels.includes("Tim Saya"), "My Team menu removed");
});

test("employee navigation excludes My Team", async () => {
  const { accessToken } = await signIn("employee", "Employee2026!");

  const res = await request(app)
    .get("/api/v1/navigation")
    .set("Authorization", `Bearer ${accessToken}`);

  assert.equal(res.status, 200);
  const labels = res.body.data.map((n) => n.label);
  assert.ok(!labels.includes("Tim Saya"));
});

test("viewing the team overview is recorded as activity", async () => {
  const { accessToken } = await signIn("manager", "Manager2026!");
  await request(app)
    .get("/api/v1/manager/team")
    .set("Authorization", `Bearer ${accessToken}`);

  const { ActivityLogModel } = require("../../src/infrastructure/models/activity-log.model");
  const records = await ActivityLogModel.find({ action: "TEAM.VIEWED" });
  assert.ok(records.length >= 1, "team overview views are activity-logged");
});
