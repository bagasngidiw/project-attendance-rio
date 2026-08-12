/**
 * ApprovalService delegation-hook tests (FR-009) — the `decide` method must
 * allow the effective delegate of an ACTIVE delegation to decide in the
 * assigned approver's stead, while preserving 404-for-others and the
 * self-approval guard. Built on in-memory fakes (no MongoDB).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { RequestService } = require("../../src/application/request.service");
const { ApprovalService } = require("../../src/application/approval.service");
const { DelegationService } = require("../../src/application/delegation.service");
const { NotFoundError, ConflictError } = require("../../src/domain/errors");

/** Minimal in-memory port matching the DelegationRepository interface. */
class InMemoryDelegationRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create({ delegatorId, delegateId, requestTypes = [], startsAt, endsAt }) {
    const entry = {
      id: `del_${this.nextId++}`,
      delegatorId: String(delegatorId),
      delegateId: String(delegateId),
      requestTypes,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: "ACTIVE",
      revokedAt: null,
      revokedBy: null,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findActiveForDelegator(delegatorId, date) {
    const d = new Date(date);
    return this.entries.filter(
      (e) =>
        e.delegatorId === String(delegatorId) &&
        e.status === "ACTIVE" &&
        new Date(e.startsAt) <= d &&
        new Date(e.endsAt) >= d
    );
  }
}

function makeServices({ withDelegation = true } = {}) {
  const fakes = buildFakes();
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
  const eventBus = new EventBus();
  const requestService = new RequestService({
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    eventBus,
  });
  const delegationRepository = new InMemoryDelegationRepository();
  const delegationService = withDelegation
    ? new DelegationService({
        delegationRepository,
        userRepository: fakes.userRepository,
        auditService,
      })
    : null;
  const approvalService = new ApprovalService({
    requestService,
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    auditService,
    eventBus,
    config: {},
    delegationService,
  });
  return { fakes, requestService, approvalService, delegationService, delegationRepository };
}

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Emp", status: "ACTIVE", managerId: "u_mgr" });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_delegate", username: "del", email: "del@corp.io", name: "Del", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_other", username: "other", email: "other@corp.io", name: "Other", status: "ACTIVE", managerId: null });
}

const LEAVE_PAYLOAD = { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" };

async function submitLeave(requestService) {
  return requestService.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: { actorId: "u_emp" },
  });
}

function approverActor(id) {
  return { actorId: id, actorRoleKeys: ["MANAGER"], actorPermissions: ["leave:approve"], correlationId: "corr_x" };
}

/** Delegation covering "all types" from the past until far in the future. */
async function createCoveringDelegation(delegationService, { delegateId = "u_delegate", requestTypes = [], actor = { actorId: "u_mgr" } } = {}) {
  return delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: {
      delegateId,
      requestTypes,
      startsAt: "2000-01-01",
      endsAt: "2100-01-01",
    },
    actor,
  });
}

test("delegation hook: an effective delegate may decide an assigned request", async () => {
  const { fakes, requestService, approvalService, delegationService } = makeServices();
  seedUsers(fakes);
  await createCoveringDelegation(delegationService);
  const req = await submitLeave(requestService);

  const decided = await approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_delegate"));

  assert.equal(decided.status, "APPROVED");
  assert.equal(decided.decision.actorId, "u_delegate");
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.APPROVED"));
});

test("delegation hook: a non-delegate third party still gets 404 when delegation exists", async () => {
  const { fakes, requestService, approvalService, delegationService } = makeServices();
  seedUsers(fakes);
  await createCoveringDelegation(delegationService);
  const req = await submitLeave(requestService);

  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_other")),
    NotFoundError
  );
});

test("delegation hook: a delegation that does not cover the request type does not authorize", async () => {
  const { fakes, requestService, approvalService, delegationService } = makeServices();
  seedUsers(fakes);
  await createCoveringDelegation(delegationService, { requestTypes: ["overtime"] });
  const req = await submitLeave(requestService); // LEAVE

  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_delegate")),
    NotFoundError
  );
});

test("delegation hook: the assigned approver can still decide when a delegation exists", async () => {
  const { fakes, requestService, approvalService, delegationService } = makeServices();
  seedUsers(fakes);
  await createCoveringDelegation(delegationService);
  const req = await submitLeave(requestService);

  const decided = await approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr"));
  assert.equal(decided.status, "APPROVED");
});

test("delegation hook: self-approval is still blocked for the effective delegate", async () => {
  const { fakes, requestService, approvalService, delegationService } = makeServices();
  seedUsers(fakes);
  // Delegate == requester: u_mgr delegates to u_emp (the requester).
  await createCoveringDelegation(delegationService, { delegateId: "u_emp" });
  const req = await submitLeave(requestService);

  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_emp")),
    (err) => err instanceof ConflictError && err.code === "SELF_APPROVAL_DENIED"
  );
});

test("delegation hook: without a delegationService the non-assigned caller stays 404", async () => {
  const { fakes, requestService, approvalService } = makeServices({ withDelegation: false });
  seedUsers(fakes);
  const req = await submitLeave(requestService);

  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_delegate")),
    NotFoundError
  );
});
