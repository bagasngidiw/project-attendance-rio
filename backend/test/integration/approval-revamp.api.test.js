/**
 * Integration tests for the Approval Workflow Revamp:
 *   FR-001 approval configuration (Superadmin CRUD + audit + 403 for others)
 *   FR-002 unified engine (target submit → PENDING_APPROVAL + snapshot; claim;
 *         approve; reject with mandatory reason; assignment scope; self-approval)
 *   FR-003 approval-targets endpoint (eligible roles + users)
 *   FR-007 Permission (Ijin) module submission
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
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

async function signIn(username, password) {
  const res = await request(app).post("/api/v1/auth/signin").send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function roleIdByKey(key) {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const roles = await request(app)
    .get("/api/v1/rbac/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  return roles.body.data.find((r) => r.key === key).id;
}

async function enableManagerFor(requestType) {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const managerRoleId = await roleIdByKey("MANAGER");
  const res = await request(app)
    .put(`/api/v1/approval-configurations/${requestType}`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      roles: [
        { roleId: managerRoleId, approvalLevel: 3, canApprove: true, canBeTarget: true },
      ],
      selfApproval: false,
    });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return managerRoleId;
}

test("FR-001: Superadmin configures eligible roles; non-admins are denied 403", async () => {
  const managerRoleId = await enableManagerFor("LEAVE");

  // Non-admin cannot read or write the configuration.
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const denied = await request(app)
    .get("/api/v1/approval-configurations")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(denied.status, 403);

  // Superadmin can read; config change is audited.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const list = await request(app)
    .get("/api/v1/approval-configurations")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(list.status, 200);
  const leave = list.body.data.find((c) => c.requestType === "LEAVE");
  assert.ok(leave.roles.some((r) => String(r.roleId) === String(managerRoleId) && r.canApprove));

  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "APPROVAL_CONFIG_UPDATED", pageSize: 20 });
  assert.ok(audit.body.data.total >= 1, "APPROVAL_CONFIG_UPDATED audited");
});

test("FR-003: approval-targets returns only configured eligible roles + users", async () => {
  const managerRoleId = await enableManagerFor("LEAVE");

  const employee = await signIn("employee", "Employee2026!");
  const targets = await request(app)
    .get("/api/v1/approval-targets?type=leave")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(targets.status, 200, JSON.stringify(targets.body));
  assert.ok(targets.body.data.roles.some((r) => String(r.roleId) === String(managerRoleId)));
  assert.ok(targets.body.data.users.some((u) => u.username === "manager"));
});

test("FR-002: submit with a ROLE target -> PENDING_APPROVAL + snapshot; claim; approve", async () => {
  const managerRoleId = await enableManagerFor("LEAVE");
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Liburan",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.status, "PENDING_APPROVAL");
  assert.equal(sub.body.data.approval.targetType, "ROLE");
  assert.equal(sub.body.data.approval.assignedUserId, null, "role target is claimable");
  assert.equal(sub.body.data.approval.configurationSnapshot.targetRoleName, "Manager");

  // The manager is an eligible approver but has NOT claimed yet — direct
  // approval before claiming is denied (404, no existence leak).
  const beforeClaim = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(beforeClaim.status, 404, "eligible but unclaimed approver cannot approve");

  // Manager claims then approves.
  const claim = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.data.approval.assignedUserId, manager.user.id);

  const approved = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "APPROVED");
  assert.equal(approved.body.data.approval.status, "APPROVED");
  assert.equal(String(approved.body.data.approval.approvedBy), manager.user.id);

  // Double approve is impossible.
  const again = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(again.status, 409);
});

test("FR-002: USER target assigns directly; rejection requires a mandatory reason", async () => {
  await enableManagerFor("LEAVE");
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Liburan",
      approvalTarget: { targetType: "USER", targetUserId: manager.user.id },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(String(sub.body.data.approval.assignedUserId), manager.user.id, "user target assigns directly");

  // Reject without a reason -> 400 (agents.md §16/§29).
  const noReason = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/reject`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ reason: "" });
  assert.equal(noReason.status, 400);

  const rejected = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/reject`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ reason: "Kuota cuti tidak mencukupi" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(rejected.body.data.approval.rejectionReason, "Kuota cuti tidak mencukupi");
  assert.equal(String(rejected.body.data.approval.rejectedBy), manager.user.id);
});

test("FR-002: self-approval is denied by default", async () => {
  await enableManagerFor("LEAVE");
  const manager = await signIn("manager", "Manager2026!");
  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Liburan",
      approvalTarget: { targetType: "USER", targetUserId: manager.user.id },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));

  const selfApprove = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(selfApprove.status, 409, "self-approval blocked");
  assert.equal(selfApprove.body.error.code, "SELF_APPROVAL_DENIED");
});

test("FR-007: Permission (Ijin) module submission", async () => {
  await enableManagerFor("PERMISSION");
  const employee = await signIn("employee", "Employee2026!");

  const sub = await request(app)
    .post("/api/v1/permission/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ date: "2026-09-10", reason: "Urusan keluarga" });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.type, "PERMISSION");
  assert.equal(sub.body.data.status, "PENDING_APPROVAL");

  // Invalid permission payload (no date/range + no reason) -> 400.
  const bad = await request(app)
    .post("/api/v1/permission/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ reason: "" });
  assert.equal(bad.status, 400);
});

test("FR-002: history exposes ASSIGNED/CLAIMED events and PENDING_APPROVAL vocabulary", async () => {
  const managerRoleId = await enableManagerFor("LEAVE");
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Liburan",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);

  const history = await request(app)
    .get(`/api/v1/requests/${sub.body.data.id}/approval-history`)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(history.status, 200);
  const events = history.body.data.events.map((e) => e.event);
  assert.ok(events.includes("ASSIGNED"), "ASSIGNED event present");
  assert.ok(events.includes("CLAIMED"), "CLAIMED event present");
  assert.ok(history.body.data.events.every((e) => e.toStatus === "PENDING_APPROVAL"));
  // FR-009: actor name/role snapshots are recorded on the timeline.
  const claimedEvent = history.body.data.events.find((e) => e.event === "CLAIMED");
  assert.equal(claimedEvent.actorNameSnapshot, "Demo Manager");
  assert.equal(claimedEvent.actorRoleNameSnapshot, "Manager");
});

test("FR-010: two eligible approvers cannot claim the same role-targeted request", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const managerRoleId = await roleIdByKey("MANAGER");
  const hrRoleId = await roleIdByKey("HR_ADMIN");
  // Configure BOTH roles as eligible for LEAVE.
  const put = await request(app)
    .put("/api/v1/approval-configurations/LEAVE")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      roles: [
        { roleId: managerRoleId, approvalLevel: 3, canApprove: true, canBeTarget: true },
        { roleId: hrRoleId, approvalLevel: 4, canApprove: true, canBeTarget: true },
      ],
      selfApproval: false,
    });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Liburan",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  const requestId = sub.body.data.id;

  const winner = await request(app)
    .post(`/api/v1/requests/${requestId}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(winner.status, 200, JSON.stringify(winner.body));

  const loser = await request(app)
    .post(`/api/v1/requests/${requestId}/claim`)
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(loser.status, 409, "second claim loses the race");
  assert.equal(loser.body.error.code, "REQUEST_ALREADY_CLAIMED");
});

/** Creates an ACTIVE sickness type via the superadmin master API. */
async function createSicknessType(name) {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/admin/sickness-types")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: name.toUpperCase().replace(/\s+/g, "_"), name });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.data.id;
}

test("FR-002: Sakit module end-to-end — role target, claim, approve", async () => {
  const managerRoleId = await enableManagerFor("SAKIT");
  const sicknessTypeId = await createSicknessType("Tifus");
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      sicknessType: sicknessTypeId,
      startDate: "2026-09-10",
      reason: "Demam tinggi",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.type, "SAKIT");
  assert.equal(sub.body.data.status, "PENDING_APPROVAL");
  assert.equal(sub.body.data.approval.targetType, "ROLE");
  assert.equal(sub.body.data.approval.configurationSnapshot.requestType, "SAKIT");
  assert.equal(sub.body.data.approval.configurationSnapshot.targetRoleName, "Manager");

  const claim = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(String(claim.body.data.approval.assignedUserId), manager.user.id);

  const approved = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "APPROVED");
  assert.equal(String(approved.body.data.approval.approvedBy), manager.user.id);
});

test("FR-002: Sakit submission rejects unknown/inactive sickness types (400)", async () => {
  await enableManagerFor("SAKIT");
  const employee = await signIn("employee", "Employee2026!");

  const unknown = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      sicknessType: "type_tidak_terdaftar",
      startDate: "2026-09-10",
      reason: "Sakit",
    });
  assert.equal(unknown.status, 400, JSON.stringify(unknown.body));
});

test("FR-002: the seeded system sickness type works out of the box", async () => {
  const managerRoleId = await enableManagerFor("SAKIT");
  const employee = await signIn("employee", "Employee2026!");

  // GET /sickness-types returns the seed-provisioned ACTIVE types; the
  // requester can submit immediately without any admin master-data setup.
  const types = await request(app)
    .get("/api/v1/sickness-types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(types.status, 200, JSON.stringify(types.body));
  assert.ok(types.body.data.some((t) => t.key === "UMUM"), "system type seeded active");

  const umum = types.body.data.find((t) => t.key === "UMUM");
  const sub = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      sicknessType: umum.id,
      startDate: "2026-09-10",
      reason: "Kurang sehat",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.type, "SAKIT");
  assert.equal(sub.body.data.status, "PENDING_APPROVAL");
});

test("FR-002: Sakit rejection requires a mandatory reason", async () => {
  await enableManagerFor("SAKIT");
  const sicknessTypeId = await createSicknessType("Tifus");
  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      sicknessType: sicknessTypeId,
      startDate: "2026-09-10",
      reason: "Tifus",
      approvalTarget: { targetType: "USER", targetUserId: manager.user.id },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));

  const noReason = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/reject`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ reason: "  " });
  assert.equal(noReason.status, 400, "rejection without a reason is denied");

  const rejected = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/reject`)
    .set("Authorization", `Bearer ${manager.accessToken}`)
    .send({ reason: "Sertifikat dokter belum dilampirkan" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(rejected.body.data.approval.rejectionReason, "Sertifikat dokter belum dilampirkan");
  assert.equal(String(rejected.body.data.approval.rejectedBy), manager.user.id);
});

test("FR-058: leave submission accepts a custom registered leave type", async () => {
  const managerRoleId = await enableManagerFor("LEAVE");
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/admin/leave-types")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: "MATERNITY", name: "Cuti Melahirkan", maxDaysPerRequest: 90 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const customTypeId = created.body.data.id;

  const employee = await signIn("employee", "Employee2026!");
  const manager = await signIn("manager", "Manager2026!");

  const sub = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: customTypeId,
      startDate: "2026-09-15",
      endDate: "2026-09-20",
      reason: "Melahirkan",
      approvalTarget: { targetType: "ROLE", targetRoleId: managerRoleId },
    });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.type, "LEAVE");
  assert.equal(sub.body.data.payload.leaveType, customTypeId);
  assert.equal(sub.body.data.status, "PENDING_APPROVAL");

  const claim = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/claim`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  const approved = await request(app)
    .post(`/api/v1/requests/${sub.body.data.id}/approve`)
    .set("Authorization", `Bearer ${manager.accessToken}`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "APPROVED");
});

test("FR-058: leave submission rejects an inactive leave type (400)", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/admin/leave-types")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ key: "SABBATICAL", name: "Cuti Panjang" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await request(app)
    .post(`/api/v1/admin/leave-types/${created.body.data.id}/deactivate`)
    .set("Authorization", `Bearer ${admin.accessToken}`);
  await enableManagerFor("LEAVE");

  const employee = await signIn("employee", "Employee2026!");
  const bad = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({
      leaveType: created.body.data.id,
      startDate: "2026-09-15",
      endDate: "2026-09-16",
      reason: "Istirahat panjang",
    });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
});
