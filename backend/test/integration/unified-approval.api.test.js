/**
 * Integration tests for FR-063 (unified single-approver workflow) and FR-064
 * (role levels + initial permissions): role CRUD with level/scope, console
 * meta/validate/preview/copy, unified approval list/drill-down/escalation,
 * and cutoff-rule administration.
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
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    approvalConfigurationRepository: repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

async function signIn(username, password) {
  const res = await request(app).post("/api/v1/auth/signin").send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function submitLeave(accessToken) {
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

test("FR-064: seeded roles carry level + dataScope; SUPER_ADMIN has the highest level", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(res.status, 200);
  const roles = res.body.data;
  const byKey = Object.fromEntries(roles.map((r) => [r.key, r]));
  assert.equal(byKey.SUPER_ADMIN.level, 100);
  assert.equal(byKey.SUPER_ADMIN.dataScope, "ALL_EMPLOYEES");
  assert.equal(byKey.MANAGER.level, 50);
  assert.equal(byKey.MANAGER.dataScope, "DIRECT_SUBORDINATES");
  assert.equal(byKey.EMPLOYEE.level, 10);
  assert.equal(byKey.EMPLOYEE.dataScope, "SELF");
});

test("FR-064: createRole accepts level/scope; meta returns checklist groups + templates", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ name: "Finance Reviewer", permissions: ["dashboard:view", "leave:view_all", "leave:approve"], level: 40, dataScope: "DEPARTMENT" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.level, 40);
  assert.equal(created.body.data.dataScope, "DEPARTMENT");

  const meta = await request(app)
    .get("/api/v1/rbac/admin/meta")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(meta.status, 200);
  assert.ok(meta.body.data.groups.some((g) => g.key === "DASHBOARD"));
  assert.ok(meta.body.data.templates.some((t) => t.key === "administrator"));
});

test("FR-064: validate endpoint surfaces dependency warnings without persisting", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .post("/api/v1/rbac/admin/roles/validate")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ permissions: ["leave:approve"] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const deps = res.body.data.dependencies ?? [];
  assert.ok(deps.some((d) => d.permission === "leave:approve"), "approve-without-view-all warning");
});

test("FR-064: preview + copy endpoints return effective access and an editable draft", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const roles = await request(app).get("/api/v1/rbac/roles").set("Authorization", `Bearer ${admin.accessToken}`);
  const manager = roles.body.data.find((r) => r.key === "MANAGER");

  const preview = await request(app)
    .get(`/api/v1/rbac/admin/roles/${manager.id}/preview`)
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(preview.status, 200);
  assert.ok(preview.body.data.preview.approvalAuthority.includes("leave:approve"));

  const copy = await request(app)
    .get(`/api/v1/rbac/admin/roles/copy/${manager.id}`)
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(copy.status, 200);
  assert.equal(copy.body.data.source.key, "MANAGER");
  assert.ok(copy.body.data.permissions.includes("leave:approve"));
});

test("FR-063: unified approval list + drill-down work for the manager", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const req = await submitLeave(employee.accessToken);

  // FR-007: auto-resolved ROLE target is claimable; the manager claims it so
  // it lands in their unified scope.
  const claim = await request(app)
    .post(`/api/v1/requests/${req.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  const unified = await request(app)
    .get("/api/v1/approvals")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(unified.status, 200);
  assert.ok(unified.body.data.total >= 1);
  assert.equal(unified.body.data.items[0].id, req.id);

  const drill = await request(app)
    .get(`/api/v1/approvals/${req.id}`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(drill.status, 200);
  assert.ok(Array.isArray(drill.body.data.events));
});

test("FR-063: escalation is recorded and never changes the request status", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const req = await submitLeave(employee.accessToken);

  const escalated = await request(app)
    .post(`/api/v1/approvals/${req.id}/escalate`)
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ message: "Please prioritize" });
  assert.equal(escalated.status, 200, JSON.stringify(escalated.body));
  assert.equal(escalated.body.data.status, "PENDING_APPROVAL");

  const history = await request(app)
    .get(`/api/v1/requests/${req.id}/history`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.ok(history.body.data.events.some((e) => e.event === "ESCALATED"));
});

test("FR-063: cutoff-rule administration requires platform:settings", async () => {
  const manager = await signIn("manager", "Manager2026!");
  const denied = await request(app)
    .post("/api/v1/admin/cutoff-rules")
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ requestType: "LEAVE", days: [1], enabled: true });
  assert.equal(denied.status, 403);

  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/admin/cutoff-rules")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ requestType: "LEAVE", days: [1], enabled: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.data.days, [1]);
});
