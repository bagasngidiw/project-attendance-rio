/**
 * RequestService tests (FR-016 / FR-036 / FR-054): submission with approver
 * routing, cancellation rules, requester scope (no existence leak), pending
 * summary provider counts, and the generic approve/reject transition.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { RequestService } = require("../../src/application/request.service");
const { NotFoundError, ConflictError } = require("../../src/domain/errors");
function makeService() {
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
  const service = new RequestService({
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    eventBus,
  });
  return { service, fakes, eventBus };
}

const LEAVE_PAYLOAD = { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" };

function seedEmployee(fakes, { id = "u_emp", managerId = "u_mgr" } = {}) {
  fakes.userRepository.seed({ id, username: id, email: `${id}@corp.io`, name: id, status: "ACTIVE", managerId });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
}

test("submitRequest creates a PENDING request, routes to the manager, records history + audit", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);

  const result = await service.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: { actorId: "u_emp", correlationId: "corr_x" },
  });

  assert.equal(result.status, "PENDING_APPROVAL");
  assert.equal(String(result.approverId), "u_mgr", "approver routed to requester's manager");

  const history = fakes.requestEventRepository.entries;
  assert.equal(history.length, 1);
  assert.equal(history[0].event, "SUBMITTED");
  assert.equal(history[0].fromStatus, "DRAFT");
  assert.equal(history[0].toStatus, "PENDING");

  const audit = fakes.auditRepository.entries.find((e) => e.action === "LEAVE.SUBMITTED");
  assert.ok(audit, "LEAVE.SUBMITTED audit event recorded");
  assert.equal(audit.metadata.type, "LEAVE");
  assert.equal(audit.correlationId, "corr_x");
  assert.ok(fakes.activityRepository.entries.some((e) => e.action === "LEAVE.SUBMITTED"));
});

test("submitRequest falls back to an ACTIVE HR admin when the requester has no manager", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_hr", key: "HR_ADMIN", name: "HR Admin", status: "ACTIVE" });
  fakes.userRoleRepository.assign("u_hr", ["r_hr"]);
  fakes.userRepository.seed({ id: "u_hr", username: "hr", email: "hr@corp.io", name: "HR", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Emp", status: "ACTIVE", managerId: null });

  const result = await service.submitRequest({
    type: "OVERTIME",
    requesterId: "u_emp",
    payload: { date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "Catch-up" },
    actor: {},
  });

  assert.equal(String(result.approverId), "u_hr");
});

test("submitRequest emits a request.submitted event (FR-014 hook)", async () => {
  const { service, fakes, eventBus } = makeService();
  seedEmployee(fakes);
  let published = null;
  eventBus.subscribe("request.submitted", (payload) => {
    published = payload;
  });

  const result = await service.submitRequest({
    type: "TRIP",
    requesterId: "u_emp",
    payload: { destination: "Singapore", startDate: "2026-10-01", endDate: "2026-10-05", purpose: "Client visit" },
    actor: {},
  });

  assert.ok(published, "notification hook fired");
  assert.equal(published.requestId, result.id);
  assert.equal(published.type, "TRIP");
});

test("cancelRequest cancels an owned PENDING request with history + audit", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });

  const cancelled = await service.cancelRequest({
    requestId: req.id,
    requesterId: "u_emp",
    reason: "Plans changed",
    actor: { actorId: "u_emp" },
  });

  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancellationReason, "Plans changed");
  assert.ok(cancelled.cancelledAt);

  const events = fakes.requestEventRepository.entries.map((e) => e.event);
  assert.deepEqual(events, ["SUBMITTED", "CANCELLED"]);
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.CANCELLED"));
});

test("cancelRequest rejects a non-owner with 404 (no existence leak) (F3)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });

  await assert.rejects(
    service.cancelRequest({ requestId: req.id, requesterId: "u_other", reason: "", actor: {} }),
    NotFoundError
  );
});

test("cancelRequest blocks cancellation after a decision (F1)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });
  await service.transition({ requestId: req.id, toStatus: "APPROVED", actor: { actorId: "u_mgr" }, comment: "ok" });

  await assert.rejects(
    service.cancelRequest({ requestId: req.id, requesterId: "u_emp", reason: "late", actor: {} }),
    (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
  );
});

test("getByIdScoped returns the timeline for the owner and 404 for others (F3)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });

  const detail = await service.getByIdScoped(req.id, "u_emp");
  assert.equal(detail.status, "PENDING_APPROVAL");
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].event, "SUBMITTED");

  await assert.rejects(service.getByIdScoped(req.id, "u_other"), NotFoundError);
});

test("listMine returns only the requester's requests with filters (F3)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });
  await service.submitRequest({
    type: "OVERTIME",
    requesterId: "u_emp",
    payload: { date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "x" },
    actor: {},
  });
  // Another user's request must never appear.
  await service.submitRequest({
    type: "TRIP",
    requesterId: "u_other",
    payload: { destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-02", purpose: "x" },
    actor: {},
  });

  const all = await service.listMine("u_emp", {});
  assert.equal(all.total, 2);
  assert.ok(all.items.every((r) => String(r.requesterId) === "u_emp"));

  const leaves = await service.listMine("u_emp", { type: "LEAVE" });
  assert.equal(leaves.total, 1);
  assert.equal(leaves.items[0].type, "LEAVE");
});

test("transition approves a PENDING request with history + audit (future FR-007)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });

  const decided = await service.transition({
    requestId: req.id,
    toStatus: "APPROVED",
    actor: { actorId: "u_mgr" },
    comment: "Approved",
  });

  assert.equal(decided.status, "APPROVED");
  assert.ok(decided.decidedAt);
  const history = fakes.requestEventRepository.entries.map((e) => e.event);
  assert.deepEqual(history, ["SUBMITTED", "APPROVED"]);
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.APPROVED"));
});

test("countPendingForUserIds counts PENDING requests per type (F4)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const a = await service.submitRequest({ type: "LEAVE", requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} });
  const b = await service.submitRequest({
    type: "OVERTIME",
    requesterId: "u_emp",
    payload: { date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "x" },
    actor: {},
  });

  assert.equal(await service.countPendingForUserIds(["u_emp"], "LEAVE"), 1);
  assert.equal(await service.countPendingForUserIds(["u_emp"], "OVERTIME"), 1);
  assert.equal(await service.countPendingForUserIds(["u_emp"], "TRIP"), 0);
  assert.equal(await service.countPendingForUserIds(["u_other"], "LEAVE"), 0);

  await service.cancelRequest({ requestId: a.id, requesterId: "u_emp", reason: "x", actor: {} });
  assert.equal(await service.countPendingForUserIds(["u_emp"], "LEAVE"), 0, "cancelled no longer pending");
  assert.equal(await service.countPendingForUserIds(["u_emp"], "OVERTIME"), 1);
  void b;
});

test("listMine items carry a summary, dates, and decision summary (E2/FR-037)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: {},
  });
  await service.transition({
    requestId: req.id,
    toStatus: "APPROVED",
    actor: { actorId: "u_mgr" },
    comment: "Approved",
  });

  const history = await service.listMine("u_emp", {});
  assert.equal(history.total, 1);
  const item = history.items[0];
  assert.ok(item.summary.includes("ANNUAL cuti"), "human-readable summary");
  assert.deepEqual(item.dates, { startDate: "2026-09-01", endDate: "2026-09-03" });
  assert.equal(item.decisionSummary.action, "APPROVED");
  assert.equal(item.decisionSummary.comment, "Approved");
  assert.ok(item.decisionSummary.decidedAt);
});

test("editPendingRequest updates a PENDING payload and records an EDITED event (D8/FR-052)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: {},
  });

  const edited = await service.editPendingRequest({
    requestId: req.id,
    requesterId: "u_emp",
    payload: { ...LEAVE_PAYLOAD, endDate: "2026-09-05", reason: "Extended vacation" },
    actor: { actorId: "u_emp", actorRoleKeys: ["EMPLOYEE"] },
  });

  assert.equal(edited.payload.endDate, "2026-09-05");
  assert.equal(edited.status, "PENDING_APPROVAL", "edit keeps the request pending");

  const events = fakes.requestEventRepository.entries.map((e) => e.event);
  assert.ok(events.includes("EDITED"), "EDITED history event appended");
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REQUEST.EDITED"));
});

test("editPendingRequest blocks editing decided requests and non-owners (D8)", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: {},
  });
  await service.transition({ requestId: req.id, toStatus: "APPROVED", actor: { actorId: "u_mgr" } });

  await assert.rejects(
    service.editPendingRequest({ requestId: req.id, requesterId: "u_emp", payload: LEAVE_PAYLOAD, actor: {} }),
    (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
  );

  await assert.rejects(
    service.editPendingRequest({ requestId: req.id, requesterId: "u_other", payload: LEAVE_PAYLOAD, actor: {} }),
    NotFoundError
  );
});

test("editPendingRequest re-validates the per-type payload", async () => {
  const { service, fakes } = makeService();
  seedEmployee(fakes);
  const req = await service.submitRequest({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: LEAVE_PAYLOAD,
    actor: {},
  });

  // Structural rule: an inverted date range must be rejected.
  await assert.rejects(
    service.editPendingRequest({
      requestId: req.id,
      requesterId: "u_emp",
      payload: { leaveType: "ANNUAL", startDate: "2026-09-05", endDate: "2026-09-01", reason: "x" },
      actor: {},
    }),
    (err) => err instanceof Error && err.code === "VALIDATION_ERROR"
  );
});
