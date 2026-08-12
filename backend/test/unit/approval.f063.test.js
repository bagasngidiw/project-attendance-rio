/**
 * FR-063 tests: unified single-approver surface — unified list, drill-down,
 * escalation, blocked-reason, cutoff blocks + override, delegated decisions.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { RequestService } = require("../../src/application/request.service");
const { ApprovalService } = require("../../src/application/approval.service");
const { EscalationService } = require("../../src/application/escalation.service");
const { CutoffRuleService } = require("../../src/application/cutoff-rule.service");
const { ConflictError, NotFoundError } = require("../../src/domain/errors");

class InMemoryEscalationRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }
  async create({ requestId, escalatorId, message = "", targetRoleLevel = null }) {
    const entry = {
      id: `esc_${this.nextId++}`,
      requestId: String(requestId),
      escalatorId: String(escalatorId),
      message,
      targetRoleLevel,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }
  async countByRequestSince(requestId, since) {
    return this.entries.filter(
      (e) => String(e.requestId) === String(requestId) && e.createdAt >= since
    ).length;
  }
  async listByRequest(requestId) {
    return this.entries.filter((e) => String(e.requestId) === String(requestId));
  }
}

class InMemoryCutoffRuleRepository {
  constructor() {
    this.rules = new Map();
  }
  async upsert(input) {
    this.rules.set(input.requestType, { ...input, updatedAt: new Date() });
    return this.rules.get(input.requestType);
  }
  async getByType(requestType) {
    return this.rules.get(requestType) ?? null;
  }
  async listAll() {
    return [...this.rules.values()];
  }
  async deleteByType(requestType) {
    this.rules.delete(requestType);
  }
}

function makeServices() {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({ auditRepository: fakes.auditRepository, salt: "test-salt" });
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
  const escalationRepository = new InMemoryEscalationRepository();
  const escalationService = new EscalationService({
    platformSettingRepository: fakes.platformSettingRepository,
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    escalationRepository,
    auditService,
    eventBus,
  });
  const cutoffRuleRepository = new InMemoryCutoffRuleRepository();
  const cutoffRuleService = new CutoffRuleService({ cutoffRuleRepository, auditService });
  const approvalService = new ApprovalService({
    requestService,
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    auditService,
    eventBus,
    config: { security: { approvals: { rejectionReasonRequired: false } } },
    escalationService,
    cutoffRuleRepository,
    calendarService: { isWorkingDay: () => false },
  });
  return { fakes, requestService, approvalService, auditService, eventBus, escalationService, escalationRepository, cutoffRuleService, cutoffRuleRepository };
}

function seed(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Emp", status: "ACTIVE", managerId: "u_mgr" });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_hr", username: "hr", email: "hr@corp.io", name: "HR", status: "ACTIVE", managerId: null });
}

const LEAVE_PAYLOAD = { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" };

function approverActor(id, permissions = ["leave:approve"]) {
  return { actorId: id, actorRoleKeys: ["MANAGER"], actorPermissions: permissions, correlationId: "corr_x" };
}

async function submitLeave(requestService, requesterId = "u_emp") {
  return requestService.submitRequest({
    type: "LEAVE",
    requesterId,
    payload: LEAVE_PAYLOAD,
    actor: { actorId: requesterId },
  });
}

test("unified list returns assigned PENDING requests for a manager (FR-063)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  await submitLeave(requestService);
  const data = await approvalService.listUnified(approverActor("u_mgr"), {});
  assert.equal(data.total, 1);
  assert.equal(data.items[0].status, "PENDING_APPROVAL");
});

test("unified list with view_all returns all in-scope PENDING requests", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  await submitLeave(requestService);
  await submitLeave(requestService, "u_hr");
  const actor = { actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"], actorPermissions: ["leave:view_all", "leave:approve"] };
  const data = await approvalService.listUnified(actor, {});
  assert.ok(data.total >= 2);
});

test("drill-down is visible to the requester and approver but 404 for others", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  const view = await approvalService.getDrillDown(req.id, approverActor("u_mgr"));
  assert.equal(view.request.id, req.id);
  await assert.rejects(
    approvalService.getDrillDown(req.id, { actorId: "u_other", actorRoleKeys: ["EMPLOYEE"], actorPermissions: [] }),
    NotFoundError
  );
});

test("escalate records history + audit + event and never changes status (FR-063)", async () => {
  const { fakes, requestService, approvalService, eventBus, escalationRepository } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  let published = null;
  eventBus.subscribe("request.escalated", (payload) => {
    published = payload;
  });

  const result = await approvalService.escalate(req.id, { message: "Please review" }, { actorId: "u_emp", actorRoleKeys: ["EMPLOYEE"], actorPermissions: [] });
  assert.equal(result.status, "PENDING_APPROVAL", "escalation does not change status");
  assert.equal(published.requestId, req.id);
  assert.equal(escalationRepository.entries.length, 1);
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.ESCALATED"));
  const events = await fakes.requestEventRepository.findByRequestId(req.id);
  assert.ok(events.some((e) => e.event === "ESCALATED"));
});

test("escalate is rate-limited (max 3 per window)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  const actor = { actorId: "u_emp", actorRoleKeys: ["EMPLOYEE"], actorPermissions: [] };
  for (let i = 0; i < 3; i += 1) {
    await approvalService.escalate(req.id, { message: `n${i}` }, actor);
  }
  await assert.rejects(
    approvalService.escalate(req.id, { message: "too many" }, actor),
    (err) => err instanceof ConflictError && err.code === "ESCALATION_RATE_LIMITED"
  );
});

test("escalate requires PENDING status", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr"));
  await assert.rejects(
    approvalService.escalate(req.id, { message: "" }, { actorId: "u_emp", actorRoleKeys: ["EMPLOYEE"], actorPermissions: [] }),
    ConflictError
  );
});

test("decide is blocked by a cutoff rule unless overridden (FR-063)", async () => {
  const { fakes, requestService, approvalService, cutoffRuleRepository } = makeServices();
  seed(fakes);
  await cutoffRuleRepository.upsert({ requestType: "LEAVE", days: [], enabled: true });
  const req = await submitLeave(requestService);

  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr")),
    (err) => err instanceof ConflictError && err.code === "APPROVAL_BLOCKED"
  );
});

test("overrideCutoff bypasses the block and records APPROVAL.OVERRIDE", async () => {
  const { fakes, requestService, approvalService, cutoffRuleRepository } = makeServices();
  seed(fakes);
  await cutoffRuleRepository.upsert({ requestType: "LEAVE", days: [], enabled: true });
  const req = await submitLeave(requestService);

  const actor = { ...approverActor("u_mgr"), actorPermissions: ["leave:approve", "platform:override_cutoff"] };
  const decided = await approvalService.decide(req.id, { decision: "APPROVED", overrideCutoff: true }, actor);
  assert.equal(decided.status, "APPROVED");
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "APPROVAL.OVERRIDE"));
});

test("getBlockedReason reports the cutoff block reason", async () => {
  const { fakes, requestService, approvalService, cutoffRuleRepository } = makeServices();
  seed(fakes);
  await cutoffRuleRepository.upsert({ requestType: "LEAVE", days: [], enabled: true });
  const req = await submitLeave(requestService);
  const reason = await approvalService.getBlockedReason(req.id, approverActor("u_mgr"));
  assert.equal(reason.blocked, true);
  assert.ok(reason.reason.length > 0);
});

test("decide by an effective delegate records APPROVAL.DELEGATED context", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  fakes.userRepository.seed({ id: "u_delegate", username: "del", email: "del@corp.io", name: "Del", status: "ACTIVE", managerId: null });
  const req = await submitLeave(requestService);

  const { DelegationService } = require("../../src/application/delegation.service");
  const delegationService = new DelegationService({
    delegationRepository: {
      async create(input) {
        return { id: "d_1", ...input, status: "ACTIVE" };
      },
      async findById() { return null; },
      async findByDelegator() { return []; },
      async findActiveForDelegator(delegatorId) {
        return [{ id: "d_1", delegatorId, delegateId: "u_delegate", requestTypes: [], startsAt: new Date(0), endsAt: new Date(Date.now() + 86400000), status: "ACTIVE" }];
      },
      async findActiveByDelegate() { return []; },
      async revoke() { return null; },
      async listActive() { return []; },
    },
    userRepository: fakes.userRepository,
    auditService: new AuditService({
      publisher: fakes.publisher,
      auditRepository: fakes.auditRepository,
      activityRepository: fakes.activityRepository,
      chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
    }),
  });
  approvalService.delegationService = delegationService;

  const decided = await approvalService.decide(req.id, { decision: "APPROVED" }, { actorId: "u_delegate", actorRoleKeys: ["MANAGER"], actorPermissions: ["leave:approve"] });
  assert.equal(decided.status, "APPROVED");
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "APPROVAL.DELEGATED"));
});
