/**
 * ApprovalService tests (FR-007 / FR-008 / FR-042): inbox scope, decision
 * guards (assignment, self-approval, permission, rejection reason), history,
 * and multi-level chain advancement.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { RequestService } = require("../../src/application/request.service");
const { ApprovalService } = require("../../src/application/approval.service");
const { NotFoundError, ValidationError, ConflictError, PermissionDeniedError } = require("../../src/domain/errors");

function makeServices() {
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
  const approvalService = new ApprovalService({
    requestService,
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    auditService,
    eventBus,
    config: { security: { approvals: { rejectionReasonRequired: true } } },
  });
  return { fakes, requestService, approvalService, auditService, eventBus };
}

function seed(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Emp", status: "ACTIVE", managerId: "u_mgr" });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_hr", username: "hr", email: "hr@corp.io", name: "HR", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_other", username: "other", email: "other@corp.io", name: "Other", status: "ACTIVE", managerId: null });
}

const LEAVE_PAYLOAD = { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" };

function approverActor(id, permissions = ["leave:approve"]) {
  return { actorId: id, actorRoleKeys: ["MANAGER"], actorPermissions: permissions, correlationId: "corr_x" };
}

async function submitLeave(requestService) {
  return requestService.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: { actorId: "u_emp" },
  });
}

test("listInbox returns only PENDING requests assigned to the caller (F4)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  await submitLeave(requestService); // assigned to u_mgr
  const other = await requestService.submitRequest({
    type: "TRIP",
    requesterId: "u_other",
    payload: { destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-02", purpose: "x" },
    actor: {},
  });
  // Route the second request to u_mgr too (as if configured).
  fakes.requestRepository.requests.get(other.id).approverId = "u_mgr";

  const inbox = await approvalService.listInbox("u_mgr", {});
  assert.equal(inbox.total, 2);
  assert.ok(inbox.items.every((r) => String(r.approverId) === "u_mgr" && r.status === "PENDING_APPROVAL"));

  const empty = await approvalService.listInbox("u_hr", {});
  assert.equal(empty.total, 0);
});

test("decide approves an assigned request with history, audit, and notification", async () => {
  const { fakes, requestService, approvalService, eventBus } = makeServices();
  seed(fakes);
  let published = null;
  eventBus.subscribe("request.decided", (payload) => {
    published = payload;
  });
  const req = await submitLeave(requestService);

  const decided = await approvalService.decide(req.id, { decision: "APPROVED", comment: "Looks good" }, approverActor("u_mgr"));

  assert.equal(decided.status, "APPROVED");
  assert.equal(decided.decision.action, "APPROVED");
  assert.equal(decided.decision.actorId, "u_mgr");
  assert.ok(decided.decidedAt);

  const history = fakes.requestEventRepository.entries.map((e) => e.event);
  assert.deepEqual(history, ["SUBMITTED", "APPROVED"]);
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.APPROVED"));
  assert.ok(published, "request.decided event published");
  assert.equal(published.toStatus, "APPROVED");
});

test("decide rejects a non-assigned caller with 404 (no existence leak) (F4)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_hr")),
    NotFoundError
  );
});

test("decide blocks self-approval (F2)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  // Simulate a mis-routed assignment back to the requester (on the stored doc).
  fakes.requestRepository.requests.get(req.id).approverId = "u_emp";
  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_emp")),
    (err) => err instanceof ConflictError && err.code === "SELF_APPROVAL_DENIED"
  );
});

test("decide requires the type-specific approve permission", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await assert.rejects(
    approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr", ["trip:approve"])),
    PermissionDeniedError
  );
});

test("reject without a reason is blocked (FR-002: reason mandatory)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await assert.rejects(
    approvalService.decide(req.id, { decision: "REJECTED", comment: "" }, approverActor("u_mgr")),
    (err) => err instanceof ValidationError && err.details.field === "comment"
  );
});

test("reject with a reason records REJECTED", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  const decided = await approvalService.decide(req.id, { decision: "REJECTED", comment: "No balance" }, approverActor("u_mgr"));
  assert.equal(decided.status, "REJECTED");
  assert.equal(decided.decision.comment, "No balance");
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.REJECTED"));
});

test("listHistory returns requests decided by the caller", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr"));

  const history = await approvalService.listHistory("u_mgr", {});
  assert.equal(history.total, 1);
  assert.equal(history.items[0].id, req.id);
  assert.equal(history.items[0].status, "APPROVED");

  const empty = await approvalService.listHistory("u_hr", {});
  assert.equal(empty.total, 0);
});

test("getHistoryScoped is visible to requester and approver but 404 for others (F4)", async () => {
  const { fakes, requestService, approvalService } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  await approvalService.decide(req.id, { decision: "REJECTED", comment: "no" }, approverActor("u_mgr"));

  const requesterView = await approvalService.getHistoryScoped(req.id, { actorId: "u_emp", actorRoleKeys: ["EMPLOYEE"] });
  assert.equal(requesterView.events.length, 2);

  const approverView = await approvalService.getHistoryScoped(req.id, { actorId: "u_mgr", actorRoleKeys: ["MANAGER"] });
  assert.equal(approverView.events.length, 2);

  await assert.rejects(
    approvalService.getHistoryScoped(req.id, { actorId: "u_other", actorRoleKeys: ["EMPLOYEE"] }),
    NotFoundError
  );
});

test("a single decision finalizes the request regardless of a stored chain (FR-063)", async () => {
  const { fakes, requestService, approvalService, eventBus } = makeServices();
  seed(fakes);
  const req = await submitLeave(requestService);
  const stored = fakes.requestRepository.requests.get(req.id);
  // Legacy chain present for history only — FR-063 never chains on it.
  stored.approvalChain = [
    { step: 0, approverId: "u_mgr", status: "PENDING" },
    { step: 1, approverId: "u_hr", status: "PENDING" },
  ];
  stored.approvalStep = 0;

  let published = null;
  eventBus.subscribe("request.decided", (payload) => {
    published = payload;
  });

  // One approval finalizes the request — no sequential steps.
  const decided = await approvalService.decide(req.id, { decision: "APPROVED" }, approverActor("u_mgr"));
  assert.equal(decided.status, "APPROVED", "single decision terminates");
  assert.ok(published && published.toStatus === "APPROVED");
});
