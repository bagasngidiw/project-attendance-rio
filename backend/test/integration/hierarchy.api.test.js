const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");

require("dotenv").config();

const { buildApp } = require("../../server");
const { createConfig } = require("../../src/infrastructure/config");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { seedDatabase } = require("../../src/infrastructure/seed/seed");
const { UserModel } = require("../../src/infrastructure/models/user.model");
const { AttendanceModel } = require("../../src/infrastructure/models/attendance.model");

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/attendance_test";

let app;
let config;

before(async () => {
  config = createConfig();
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const built = buildApp(config);
  app = built.app;
  await seedDatabase({
    roleRepository: built.repositories.roleRepository,
    permissionRepository: built.repositories.permissionRepository,
    userRepository: built.repositories.userRepository,
    leaveTypeRepository: built.repositories.leaveTypeRepository,
    sicknessTypeRepository: built.repositories.sicknessTypeRepository,
    approvalConfigurationRepository: built.repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

async function signIn(username, password) {
  const response = await request(app).post("/api/v1/auth/signin").send({ username, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

test("hierarchy chart scopes users and approval targets to active ancestors", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const manager = await signIn("manager", "Manager2026!");
  const employee = await signIn("employee", "Employee2026!");

  const contract = await request(app)
    .post("/api/v1/admin/contract-types")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: "HIER_TEST_CONTRACT", name: "Hierarchy Test Contract" });
  assert.equal(contract.status, 201, JSON.stringify(contract.body));
  const placement = await request(app)
    .post("/api/v1/admin/placements")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: "HIER_TEST_PLACEMENT", name: "Hierarchy Test Placement" });
  assert.equal(placement.status, 201, JSON.stringify(placement.body));

  await UserModel.updateMany(
    { username: { $in: ["manager", "employee", "employee.bob"] } },
    {
      $set: {
        contractTypeId: contract.body.data.id,
        placementId: placement.body.data.id,
      },
    }
  );

  const managerRoleId = (await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`)).body.data.find((role) => role.key === "MANAGER").id;
  const configured = await request(app)
    .put("/api/v1/approval-configurations/LEAVE")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      roles: [{ roleId: managerRoleId, approvalLevel: 3, canApprove: true, canBeTarget: true }],
      selfApproval: false,
    });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));

  const created = await request(app)
    .post("/api/v1/hierarchies")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ contractTypeId: contract.body.data.id, placementId: placement.body.data.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let chart = created.body.data;

  const add = async (userId, relation, anchorNodeId = null) => {
    const response = await request(app)
      .post(`/api/v1/hierarchies/${chart.id}/nodes`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ userId, relation, anchorNodeId, expectedVersion: chart.version });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    chart = response.body.data;
    return chart.nodes[chart.nodes.length - 1];
  };

  const root = await add(manager.user.id, "ROOT");
  const employeeNode = await add(employee.user.id, "CHILD", root.nodeId);
  assert.ok(employeeNode);
  await request(app)
    .post(`/api/v1/hierarchies/${chart.id}/activate`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ expectedVersion: chart.version });

  const employeeRecord = await UserModel.findOne({ username: "employee" });
  const unrelatedRecord = await UserModel.findOne({ username: "employee.bob" });
  await AttendanceModel.create([
    { userId: employeeRecord.id, date: "2026-11-01", status: "NORMAL" },
    { userId: unrelatedRecord.id, date: "2026-11-01", status: "NORMAL" },
  ]);
  const attendance = await request(app)
    .get("/api/v1/attendance")
    .query({ from: "2026-11-01", to: "2026-11-01" })
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(attendance.status, 200, JSON.stringify(attendance.body));
  assert.ok(attendance.body.data.items.some((item) => String(item.userId) === String(employeeRecord.id)));
  assert.equal(attendance.body.data.items.some((item) => String(item.userId) === String(unrelatedRecord.id)), false);

  const targets = await request(app)
    .get("/api/v1/approval-targets?type=leave")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(targets.status, 200, JSON.stringify(targets.body));
  assert.ok(targets.body.data.users.some((user) => String(user.userId) === String(manager.user.id)));

  const submitted = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-11-01",
      endDate: "2026-11-01",
      reason: "Hierarchy test",
      approvalTarget: { targetType: "USER", targetUserId: manager.user.id },
    });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  assert.equal(String(submitted.body.data.approval.assignedUserId), String(manager.user.id));
  assert.equal(String(submitted.body.data.approval.configurationSnapshot.hierarchyId), String(chart.id));

  const visible = await request(app)
    .get("/api/v1/requests/visible?type=LEAVE")
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(visible.status, 200, JSON.stringify(visible.body));
  assert.ok(visible.body.data.items.some((item) => String(item.requesterId) === String(employee.user.id)));
});
