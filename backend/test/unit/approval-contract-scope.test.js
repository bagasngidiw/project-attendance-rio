/**
 * FR-004 unit tests: approval target users are scoped by the requester's
 * contract (Kontrak). Same-contract OR contract-less approvers are eligible;
 * contract-less requesters see everyone. The rule is enforced in the targets
 * API, submission validation, default-role resolution, and claiming — never
 * on the frontend.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { ApprovalConfigurationService } = require("../../src/application/approval-configuration.service");
const { ApprovalTargetService } = require("../../src/application/approval-target.service");
const { RequestService } = require("../../src/application/request.service");
const { ApprovalEngineService } = require("../../src/application/approval-engine.service");
const { ValidationError, PermissionDeniedError } = require("../../src/domain/errors");

const CONTRACT_A = "contract_a";
const CONTRACT_B = "contract_b";

function makeServices() {
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
  const approvalTargetService = new ApprovalTargetService({
    approvalConfigurationService,
    userRepository: fakes.userRepository,
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
  return { fakes, bus, approvalConfigurationService, approvalTargetService, engine, requestService };
}

/**
 * Seeds one eligible approver role + ACTIVE users:
 *  - u_a  belongs to CONTRACT_A
 *  - u_b  belongs to CONTRACT_B
 *  - u_gl is contract-less (general approver, e.g. admin_simbika/superadmin)
 */
async function seedApproverPool(fakes, { requestType = "LEAVE", level = 2 } = {}) {
  const role = fakes.roleRepository.seed({
    id: "r_approver",
    key: "APPROVER",
    name: "Approver",
    status: "ACTIVE",
    level: 50,
  });
  fakes.userRepository.seed({ id: "u_a", username: "u_a", name: "User A", status: "ACTIVE", contractTypeId: CONTRACT_A });
  fakes.userRepository.seed({ id: "u_b", username: "u_b", name: "User B", status: "ACTIVE", contractTypeId: CONTRACT_B });
  fakes.userRepository.seed({ id: "u_gl", username: "u_gl", name: "General", status: "ACTIVE", contractTypeId: null });
  fakes.userRoleRepository.assign("u_a", [role.id]);
  fakes.userRoleRepository.assign("u_b", [role.id]);
  fakes.userRoleRepository.assign("u_gl", [role.id]);
  await fakes.approvalConfigurationRepository.upsert({
    requestType,
    roles: [{ roleId: role.id, approvalLevel: level, canApprove: true, canBeTarget: true }],
    selfApproval: false,
  });
  return role;
}

test("FR-004: getEligibleUsers scopes by contract (same contract OR contract-less)", async () => {
  const { fakes, approvalConfigurationService } = makeServices();
  await seedApproverPool(fakes);

  const scoped = await approvalConfigurationService.getEligibleUsers("LEAVE", null, {
    contractTypeId: CONTRACT_A,
  });
  const ids = scoped.map((u) => u.userId).sort();
  assert.deepEqual(ids, ["u_a", "u_gl"], "same-contract + contract-less only");

  // Backward compatibility: without opts, all ACTIVE eligible users return.
  const all = await approvalConfigurationService.getEligibleUsers("LEAVE");
  assert.deepEqual(
    all.map((u) => u.userId).sort(),
    ["u_a", "u_b", "u_gl"],
    "no opts -> unfiltered (original behavior)"
  );
});

test("FR-004: approval-targets API resolves requester contract and scopes users", async () => {
  const { fakes, approvalTargetService } = makeServices();
  await seedApproverPool(fakes);
  fakes.userRepository.seed({ id: "u_req_a", username: "u_req_a", status: "ACTIVE", contractTypeId: CONTRACT_A });

  const targets = await approvalTargetService.getEligibleTargets("leave", null, "u_req_a");
  assert.deepEqual(
    targets.users.map((u) => u.userId).sort(),
    ["u_a", "u_gl"],
    "requester in contract A sees A + general approvers"
  );

  // Contract-less requester sees everyone.
  fakes.userRepository.seed({ id: "u_req_gl", username: "u_req_gl", status: "ACTIVE", contractTypeId: null });
  const targetsAll = await approvalTargetService.getEligibleTargets("leave", null, "u_req_gl");
  assert.deepEqual(
    targetsAll.users.map((u) => u.userId).sort(),
    ["u_a", "u_b", "u_gl"],
    "contract-less requester sees all eligible users"
  );
});

test("FR-004: submitting a USER target from another contract is rejected", async () => {
  const { fakes, engine } = makeServices();
  await seedApproverPool(fakes);
  fakes.userRepository.seed({ id: "u_req_a", username: "u_req_a", status: "ACTIVE", contractTypeId: CONTRACT_A });

  await assert.rejects(
    engine.prepareSubmission({
      requestType: "LEAVE",
      requesterId: "u_req_a",
      input: { approvalTarget: { targetType: "USER", targetUserId: "u_b" } },
    }),
    (err) => err instanceof ValidationError,
    "cross-contract user target must fail validation"
  );
});

test("FR-004: submitting a USER target from the same contract (or contract-less) succeeds", async () => {
  const { fakes, engine } = makeServices();
  await seedApproverPool(fakes);
  fakes.userRepository.seed({ id: "u_req_a", username: "u_req_a", status: "ACTIVE", contractTypeId: CONTRACT_A });

  const same = await engine.prepareSubmission({
    requestType: "LEAVE",
    requesterId: "u_req_a",
    input: { approvalTarget: { targetType: "USER", targetUserId: "u_a" } },
  });
  assert.equal(same.targetUserId, "u_a", "same-contract approver accepted");

  const general = await engine.prepareSubmission({
    requestType: "LEAVE",
    requesterId: "u_req_a",
    input: { approvalTarget: { targetType: "USER", targetUserId: "u_gl" } },
  });
  assert.equal(general.targetUserId, "u_gl", "contract-less approver accepted");
});

test("FR-004: default role resolution skips roles with no in-contract users", async () => {
  const { fakes, engine } = makeServices();
  // Only contract-B users hold the role; requester is in contract A.
  const role = await seedApproverPool(fakes);
  fakes.userRepository.seed({ id: "u_req_a", username: "u_req_a", status: "ACTIVE", contractTypeId: CONTRACT_A });
  // Remove the in-contract + general holders so nothing matches A.
  fakes.userRoleRepository.assign("u_a", []);
  fakes.userRoleRepository.assign("u_gl", []);

  const target = await engine.resolveDefaultTarget("LEAVE", "u_req_a");
  assert.equal(target, null, "no eligible in-contract user -> legacy fallback");

  // With a contract-less approver, the role resolves.
  fakes.userRoleRepository.assign("u_gl", [role.id]);
  const resolved = await engine.resolveDefaultTarget("LEAVE", "u_req_a");
  assert.equal(resolved.targetRoleId, role.id, "contract-less approver keeps the role targetable");
});

test("FR-004: a user from another contract cannot claim a role-targeted request", async () => {
  const { fakes, engine } = makeServices();
  await seedApproverPool(fakes);
  fakes.userRepository.seed({ id: "u_req_a", username: "u_req_a", status: "ACTIVE", contractTypeId: CONTRACT_A });

  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_req_a",
    payload: {},
    status: "PENDING",
  });
  request.approval = {
    targetType: "ROLE",
    targetRoleId: "r_approver",
    targetUserId: null,
    assignedUserId: null,
    status: "PENDING_APPROVAL",
  };

  // u_b belongs to another contract -> denied.
  await assert.rejects(
    engine.claimApproval(request.id, "u_b", { actorId: "u_b", actorRoleKeys: ["APPROVER"] }),
    PermissionDeniedError
  );

  // u_a (same contract) can claim; u_gl (contract-less) also can.
  const claimed = await engine.claimApproval(request.id, "u_a", {
    actorId: "u_a",
    actorRoleKeys: ["APPROVER"],
  });
  assert.equal(claimed.approval.assignedUserId, "u_a");
});