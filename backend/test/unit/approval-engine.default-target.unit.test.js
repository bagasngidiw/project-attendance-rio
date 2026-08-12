/**
 * ApprovalEngineService FR-007 unit tests: when a submission carries no
 * explicit approvalTarget, the engine resolves the default eligible ROLE
 * target (highest approval level, targetable, with eligible ACTIVE users).
 * Explicit targets are still preferred and validated; legacy fallback (null)
 * applies when no eligible role exists.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { ApprovalConfigurationService } = require("../../src/application/approval-configuration.service");
const { RequestService } = require("../../src/application/request.service");
const { ApprovalEngineService } = require("../../src/application/approval-engine.service");

function makeEngine(overrides = {}) {
  const fakes = buildFakes();
  const bus = new EventBus();
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const approvalConfigurationService = new ApprovalConfigurationService({
    approvalConfigurationRepository: fakes.approvalConfigurationRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    userRepository: fakes.userRepository,
    auditService,
  });
  const requestService = new RequestService({
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    eventBus: bus,
  });
  const engine = new ApprovalEngineService({
    approvalConfigurationService,
    requestService,
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    eventBus: bus,
  });
  return { engine, fakes, bus, approvalConfigurationService, requestService };
}

/** Seeds roles + users + a configured approval entry for a request type. */
async function seedEligibleRole(fakes, { requestType = "LEAVE", level = 2, canBeTarget = true, users = ["u_emp"] } = {}) {
  const role = fakes.roleRepository.seed({
    id: "r_mgr",
    key: "MANAGER",
    name: "Manager",
    status: "ACTIVE",
    level: 50,
  });
  for (const uid of users) {
    fakes.userRepository.seed({ id: uid, username: uid, status: "ACTIVE" });
    fakes.userRoleRepository.assign(uid, [role.id]);
  }
  await fakes.approvalConfigurationRepository.upsert({
    requestType,
    roles: [
      { roleId: role.id, approvalLevel: level, canApprove: true, canBeTarget },
    ],
    selfApproval: false,
  });
  return role;
}

test("FR-007: no target -> default eligible ROLE target with snapshot; claimable", async () => {
  const { engine, fakes } = makeEngine();
  await seedEligibleRole(fakes, { level: 2, users: ["u_emp", "u_hr"] });

  const assignment = await engine.prepareSubmission({
    requestType: "LEAVE",
    input: { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-02", reason: "x" },
  });

  assert.ok(assignment, "assignment resolved");
  assert.equal(assignment.targetType, "ROLE");
  assert.equal(assignment.targetRoleId, "r_mgr");
  assert.equal(assignment.assignedUserId, null, "role target stays claimable");
  assert.equal(assignment.status, "PENDING_APPROVAL");
  assert.equal(assignment.configurationSnapshot.targetRoleName, "Manager");
  assert.equal(assignment.configurationSnapshot.targetRoleLevel, 2);
});

test("FR-007: picks the highest-level targetable role with eligible users", async () => {
  const { engine, fakes } = makeEngine();
  // Two roles: high level but NO users (skipped), lower level WITH users.
  const roleHigh = fakes.roleRepository.seed({ id: "r_hr", key: "HR_ADMIN", name: "HR Admin", status: "ACTIVE", level: 80 });
  const roleLow = fakes.roleRepository.seed({ id: "r_mgr", key: "MANAGER", name: "Manager", status: "ACTIVE", level: 50 });
  fakes.userRepository.seed({ id: "u_mgr", username: "u_mgr", status: "ACTIVE" });
  fakes.userRoleRepository.assign("u_mgr", [roleLow.id]);
  await fakes.approvalConfigurationRepository.upsert({
    requestType: "LEAVE",
    roles: [
      { roleId: roleHigh.id, approvalLevel: 3, canApprove: true, canBeTarget: true },
      { roleId: roleLow.id, approvalLevel: 2, canApprove: true, canBeTarget: true },
    ],
    selfApproval: false,
  });

  const assignment = await engine.prepareSubmission({
    requestType: "LEAVE",
    input: {},
  });

  assert.equal(assignment.targetRoleId, "r_mgr", "skips roles without eligible users");
  assert.equal(assignment.configurationSnapshot.targetRoleName, "Manager");
});

test("FR-007: non-targetable roles are never auto-selected", async () => {
  const { engine, fakes } = makeEngine();
  await seedEligibleRole(fakes, { level: 2, canBeTarget: false });

  const assignment = await engine.prepareSubmission({ requestType: "LEAVE", input: {} });
  assert.equal(assignment, null, "no targetable role -> legacy fallback");
});

test("FR-007: no eligible role at all -> null (legacy routing preserved)", async () => {
  const { engine } = makeEngine();
  const assignment = await engine.prepareSubmission({ requestType: "LEAVE", input: {} });
  assert.equal(assignment, null);
});

test("FR-007: explicit targets are still honored and validated", async () => {
  const { engine, fakes } = makeEngine();
  await seedEligibleRole(fakes, { level: 2, users: ["u_emp"] });

  const assignment = await engine.prepareSubmission({
    requestType: "LEAVE",
    input: { approvalTarget: { targetType: "ROLE", targetRoleId: "r_mgr" } },
  });
  assert.ok(assignment);
  assert.equal(assignment.targetType, "ROLE");
  assert.equal(assignment.targetRoleId, "r_mgr");

  // An unknown role target is rejected with a clear validation error.
  await assert.rejects(
    engine.prepareSubmission({
      requestType: "LEAVE",
      input: { approvalTarget: { targetType: "ROLE", targetRoleId: "r_missing" } },
    }),
    (err) => err instanceof Error
  );
});

test("FR-007: end-to-end submission without a target persists a ROLE assignment", async () => {
  const { engine, requestService, fakes } = makeEngine();
  const role = await seedEligibleRole(fakes, { level: 2, users: ["u_emp"] });
  fakes.userRepository.seed({ id: "u_req", username: "u_req", status: "ACTIVE" });

  const approval = await engine.prepareSubmission({
    requestType: "LEAVE",
    input: { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-02", reason: "x" },
  });
  const dto = await requestService.submitRequest({
    type: "LEAVE",
    requesterId: "u_req",
    payload: { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-02", reason: "x" },
    actor: {},
    approval,
  });

  assert.equal(dto.status, "PENDING_APPROVAL");
  assert.equal(dto.approval.targetType, "ROLE");
  assert.equal(dto.approval.targetRoleId, role.id);
  assert.equal(dto.approval.assignedUserId, null);
  assert.equal(dto.approval.configurationSnapshot.targetRoleName, "Manager");
});
