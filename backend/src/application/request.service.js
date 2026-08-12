/**
 * RequestService — shared request lifecycle orchestration (FR-016).
 *
 * One implementation serves leave, overtime, and business trip: create in
 * DRAFT, transition to PENDING (assigning an approver), cancel only while
 * PENDING, and list/view scoped to the requester. Every transition appends an
 * immutable history entry, records an audit event, and emits an in-process
 * notification hook (FR-014 seam). The generic approve/reject transition is
 * implemented here for the future approval inbox (FR-007) but is not yet
 * exposed via routes.
 */

const {
  REQUEST_STATUS,
  assertValidTransition,
  assertCancelAllowed,
  assertNoSelfApproval,
  validateLeavePayload,
  validateOvertimePayload,
  validateTripPayload,
  validatePermissionPayload,
  validateSakitPayload,
} = require("../domain/request");
const { NotFoundError, ValidationError, ConflictError } = require("../domain/errors");

const AUDIT_ACTION_BY_TYPE = Object.freeze({
  LEAVE: "LEAVE.SUBMITTED",
  OVERTIME: "OVERTIME.SUBMITTED",
  TRIP: "TRIP.SUBMITTED",
  // FR-007: Permission (Ijin) module.
  PERMISSION: "PERMISSION.SUBMITTED",
  // TODO.md: Sickness (Sakit) module.
  SAKIT: "SAKIT.SUBMITTED",
});

const HISTORY_EVENT_BY_TRANSITION = Object.freeze({
  [REQUEST_STATUS.PENDING]: "SUBMITTED",
  [REQUEST_STATUS.APPROVED]: "APPROVED",
  [REQUEST_STATUS.REJECTED]: "REJECTED",
  [REQUEST_STATUS.CANCELLED]: "CANCELLED",
});

class RequestService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/request-event.repository').RequestEventRepository} deps.requestEventRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   * @param {import('./routing.service').RoutingService} [deps.routingService] optional routing (FR-042)
   */
  constructor({
    requestRepository,
    requestEventRepository,
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
    eventBus,
    routingService = null,
    leaveTypeService = null,
    sicknessTypeService = null,
  }) {
    this.requestRepository = requestRepository;
    this.requestEventRepository = requestEventRepository;
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.auditService = auditService;
    this.eventBus = eventBus;
    this.routingService = routingService;
    this.leaveTypeService = leaveTypeService;
    this.sicknessTypeService = sicknessTypeService;
  }

  /**
   * Submits a request: DRAFT → PENDING with an assigned approver, history,
   * audit, and notification hook (design §5.1).
   *
   * When an `approval` subdocument is supplied (FR-002 target-based workflow)
   * it is persisted with the transition and routing is skipped; the assigned
   * approver comes from `approval.assignedUserId` (null for role-targeted
   * requests, which stay claimable).
   *
   * @param {{ type: string, requesterId: string, payload: object, actor: object, approval?: object|null }} input
   */
  async submitRequest({ type, requesterId, payload, actor = {}, approval = null }) {
    // The approval target is workflow metadata, not a user-facing payload
    // field — it lives in the embedded `approval` subdocument. Strip it from
    // the stored payload so detail views never render "[object Object]".
    const { approvalTarget, ...storedPayload } = payload ?? {};
    const request = await this.requestRepository.create({
      type,
      requesterId,
      payload: storedPayload,
      status: REQUEST_STATUS.DRAFT,
    });

    assertValidTransition(REQUEST_STATUS.DRAFT, REQUEST_STATUS.PENDING);

    // Routing (FR-042): resolve the approval chain via the routing service,
    // falling back to the legacy manager/HR-admin resolution when not wired.
    // FR-002: a supplied approval target overrides auto-routing.
    let approverId = null;
    let approvalChain = null;
    if (approval) {
      approverId = approval.assignedUserId ?? null;
    } else if (this.routingService) {
      const routing = await this.routingService.resolveChain(requesterId, type);
      approverId = routing.approverId;
      approvalChain = routing.chain.map((id, index) => ({
        step: index,
        approverId: id,
        status: "PENDING",
      }));
      // A type without a routing rule falls back to the legacy resolution.
      if (!approverId) {
        approverId = await this.resolveApprover(requesterId);
      }
    } else {
      approverId = await this.resolveApprover(requesterId);
    }

    const fields = { approverId, submittedAt: new Date() };
    if (approval) {
      fields.approval = approval;
    }
    if (approvalChain && approvalChain.length > 0) {
      fields.approvalChain = approvalChain;
    }

    const pending = await this.requestRepository.updateStatus(request.id, {
      toStatus: REQUEST_STATUS.PENDING,
      version: request.version,
      fields,
    });

    await this.recordTransition({
      request: pending,
      fromStatus: REQUEST_STATUS.DRAFT,
      toStatus: REQUEST_STATUS.PENDING,
      actorId: requesterId,
      comment: "",
      auditAction: AUDIT_ACTION_BY_TYPE[type],
      metadata: { approverId: approverId?.toString?.() ?? null },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    await this.eventBus.publish("request.submitted", {
      requestId: pending.id,
      type,
      requesterId,
      approverId: approverId?.toString?.() ?? null,
      payload,
    });

    // FR-002: a target-based submission records the ASSIGNED history event +
    // audit + bus event so the approval timeline is complete from the start.
    if (approval) {
      const snapshot = await this.resolveActorSnapshot(requesterId);
      await this.requestEventRepository.append({
        requestId: pending.id,
        event: "ASSIGNED",
        actorId: requesterId,
        ...snapshot,
        comment: "",
        fromStatus: REQUEST_STATUS.PENDING,
        toStatus: REQUEST_STATUS.PENDING,
      });
      await this.auditService.record({
        action: "REQUEST.ASSIGNED",
        actor: { userId: requesterId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "REQUEST", id: pending.id, summary: `${type} approval target assigned` },
        outcome: "SUCCESS",
        metadata: {
          requestId: pending.id,
          type,
          targetType: approval.targetType,
          assignedUserId: approval.assignedUserId?.toString?.() ?? null,
        },
        correlationId: actor.correlationId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      await this.eventBus.publish("request.assigned", {
        requestId: pending.id,
        type,
        requesterId,
        assignedUserId: approval.assignedUserId?.toString?.() ?? null,
      });
    }

    return this.toDto(pending);
  }

  /**
   * Cancels a PENDING request owned by the requester (FR-016 §3.3).
   *
   * @param {{ requestId: string, requesterId: string, reason?: string, actor: object }} input
   */
  async cancelRequest({ requestId, requesterId, reason = "", actor = {} }) {    const request = await this.requestRepository.findScoped(requestId, requesterId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    assertCancelAllowed(request.status);

    const cancelled = await this.requestRepository.updateStatus(request.id, {
      toStatus: REQUEST_STATUS.CANCELLED,
      version: request.version,
      fields: {
        cancellationReason: reason,
        cancelledAt: new Date(),
      },
    });

    await this.recordTransition({
      request: cancelled,
      fromStatus: request.status,
      toStatus: REQUEST_STATUS.CANCELLED,
      actorId: requesterId,
      comment: reason,
      auditAction: "REQUEST.CANCELLED",
      metadata: { cancellationReason: reason },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    await this.eventBus.publish("request.cancelled", {
      requestId: cancelled.id,
      type: cancelled.type,
      requesterId,
      reason,
    });

    return this.toDto(cancelled);
  }

  /**
   * Edits a PENDING request owned by the requester (FR-052). Decided requests
   * are immutable. The per-type payload is re-validated, the payload updated
   * (version-guarded), and an EDITED history + audit entry is recorded.
   *
   * @param {{ requestId: string, requesterId: string, payload: object, actor?: object }} input
   */
  async editPendingRequest({ requestId, requesterId, payload, actor = {} }) {
    const request = await this.requestRepository.findScoped(requestId, requesterId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    if (request.status !== REQUEST_STATUS.PENDING) {
      throw new ConflictError(
        "Only pending requests can be edited.",
        "INVALID_STATUS_TRANSITION"
      );
    }

    const nextPayload = payload ?? {};
    this.validatePayloadForType(request.type, nextPayload);

    const updated = await this.requestRepository.updateStatus(request.id, {
      toStatus: REQUEST_STATUS.PENDING,
      version: request.version,
      fields: { payload: nextPayload },
    });

    await this.requestEventRepository.append({
      requestId: request.id,
      event: "EDITED",
      actorId: requesterId,
      comment: "",
      fromStatus: REQUEST_STATUS.PENDING,
      toStatus: REQUEST_STATUS.PENDING,
    });

    await this.auditService.record({
      action: "REQUEST.EDITED",
      actor: { userId: requesterId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "REQUEST", id: request.id, summary: `${request.type} edited` },
      outcome: "SUCCESS",
      metadata: {
        requestId: request.id,
        type: request.type,
        fields: Object.keys(nextPayload),
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return await this.toHistoryItem(updated);
  }

  /** Validates a payload against the request type's domain rules (FR-052). */
  validatePayloadForType(type, payload) {
    const dispatch = {
      LEAVE: validateLeavePayload,
      OVERTIME: validateOvertimePayload,
      TRIP: validateTripPayload,
      PERMISSION: validatePermissionPayload,
      SAKIT: validateSakitPayload,
    };
    const validator = dispatch[type];
    if (validator) validator(payload);
  }

  /**
   * Generic decision transition (approve/reject) — the approval inbox
   * (FR-007) will expose this via routes; the domain + history + audit are
   * complete and tested today. `approvalFields` are merged into the embedded
   * approval subdocument in the SAME atomic update (FR-002/FR-010).
   *
   * @param {{ requestId: string, toStatus: string, actor: object, comment?: string, approvalFields?: object|null }} input
   */
  async transition({ requestId, toStatus, actor = {}, comment = "", approvalFields = null }) {
    if (![REQUEST_STATUS.APPROVED, REQUEST_STATUS.REJECTED].includes(toStatus)) {
      throw new ValidationError("Only APPROVED or REJECTED are valid decisions.", {
        field: "toStatus",
      });
    }
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    assertValidTransition(request.status, toStatus);

    const fields = { decidedAt: new Date() };
    if ([REQUEST_STATUS.APPROVED, REQUEST_STATUS.REJECTED].includes(toStatus)) {
      fields.decision = {
        action: toStatus,
        actorId: actor.actorId ?? null,
        comment,
        decidedAt: new Date(),
      };
    }
    if (approvalFields) {
      fields.approval = { ...(request.approval ?? {}), ...approvalFields };
    }

    const decided = await this.requestRepository.updateStatus(request.id, {
      toStatus,
      version: request.version,
      fields,
    });

    await this.recordTransition({
      request: decided,
      fromStatus: request.status,
      toStatus,
      actorId: actor.actorId ?? null,
      comment,
      auditAction: toStatus === REQUEST_STATUS.APPROVED ? "REQUEST.APPROVED" : "REQUEST.REJECTED",
      metadata: {},
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    await this.eventBus.publish("request.decided", {
      requestId: decided.id,
      type: decided.type,
      requesterId: decided.requesterId,
      toStatus,
      comment,
    });

    return this.toDto(decided);
  }

  /**
   * Requester-scoped history with filters (FR-037 foundation). Each item is
   * enriched with a human-readable summary, display dates, and the decision
   * summary (FR-037 DTO).
   *
   * @param {string} requesterId
   * @param {{ status?: string, type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async listMine(requesterId, filters = {}) {
    // Map the agents.md API status back to the internal code for the query.
    const queryFilters = { ...filters };
    if (queryFilters.status === "PENDING_APPROVAL") {
      queryFilters.status = REQUEST_STATUS.PENDING;
    }
    const { items, total } = await this.requestRepository.findByRequesterId(
      requesterId,
      queryFilters
    );
    return {
      items: await Promise.all(items.map((item) => this.toHistoryItem(item))),
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /** Enriches a request DTO for the employee history surface (FR-037). */
  async toHistoryItem(item) {
    const dto = this.toDto(item);
    return {
      ...dto,
      summary: await this.summarizeRequest(dto),
      dates: requestDates(dto),
      decisionSummary: dto.decision
        ? {
            action: dto.decision.action,
            decidedAt: dto.decision.decidedAt,
            comment: dto.decision.comment,
          }
        : null,
    };
  }

  /**
   * Human-readable request summary with per-type labels. LEAVE resolves the
   * type name from the stored `leaveTypeName`, the leave-type registry, or
   * finally the raw id/key; SAKIT likewise via `sicknessTypeName` / the
   * sickness-type registry. Summaries never show "Trip to ..." or an ObjectId
   * for Sakit/Ijin/Cuti.
   */
  async summarizeRequest(request) {
    let leaveName = null;
    if (request.type === "LEAVE") {
      leaveName = request.payload?.leaveTypeName;
      if (!leaveName && this.leaveTypeService && request.payload?.leaveType) {
        const type = await this.leaveTypeService.findById(request.payload.leaveType);
        leaveName = type?.name ?? null;
      }
    }
    let sicknessName = null;
    if (request.type === "SAKIT") {
      sicknessName = request.payload?.sicknessTypeName;
      if (!sicknessName && this.sicknessTypeService && request.payload?.sicknessType) {
        const type = await this.sicknessTypeService.findById(request.payload.sicknessType);
        sicknessName = type?.name ?? null;
      }
    }
    return summarizeRequest(request, leaveName, sicknessName);
  }

  /**
   * Scoped detail + full history timeline (FR-008 base). Non-owners receive a
   * NotFoundError — no existence leak.
   *
   * @param {string} requestId
   * @param {string} requesterId
   */
  async getByIdScoped(requestId, requesterId) {
    const request = await this.requestRepository.findScoped(requestId, requesterId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    const events = await this.requestEventRepository.findByRequestId(requestId);
    return { ...this.toDto(request), events: events.map((e) => this.toEventDto(e)) };
  }

  /** PendingSummary provider primitive (FR-006). */
  async countPendingForUserIds(userIds, type) {
    return this.requestRepository.countPendingForUserIds(userIds, type);
  }

  /** Routes a submission to the requester's manager; falls back to an ACTIVE HR admin. */
  async resolveApprover(requesterId) {
    const requester = await this.userRepository.findById(requesterId);
    if (requester?.managerId) return requester.managerId;

    const hrAdminRole = await this.roleRepository.findByKey("HR_ADMIN");
    if (hrAdminRole) {
      const holders = await this.userRoleRepository.userIdsForRole(hrAdminRole.id);
      for (const holderId of holders) {
        const holder = await this.userRepository.findById(holderId);
        if (holder && holder.status === "ACTIVE") return holder.id;
      }
    }
    return null;
  }

  /** Appends the history entry and audit event for a transition. */
  async recordTransition({ request, fromStatus, toStatus, actorId, comment, auditAction, metadata, correlationId, ip, userAgent }) {
    // FR-009: immutable actor/role name snapshot for the history timeline.
    const snapshot = await this.resolveActorSnapshot(actorId);
    await this.requestEventRepository.append({
      requestId: request.id,
      event: HISTORY_EVENT_BY_TRANSITION[toStatus] ?? toStatus,
      actorId,
      ...snapshot,
      comment,
      fromStatus,
      toStatus,
    });

    await this.auditService.record({
      action: auditAction,
      actor: { userId: actorId ?? null, roleKeys: [] },
      subject: {
        type: "REQUEST",
        id: request.id,
        summary: `${request.type} ${toStatus}`,
      },
      outcome: "SUCCESS",
      metadata: {
        requestId: request.id,
        type: request.type,
        fromStatus,
        toStatus,
        ...metadata,
      },
      correlationId: correlationId ?? "",
      ip: ip ?? "",
      userAgent: userAgent ?? "",
    });
  }

  toDto(request) {
    const id = request.id ?? request._id;
    return {
      id: String(id),
      type: request.type,
      requesterId: request.requesterId?.toString?.() ?? request.requesterId,
      status: mapApiStatus(request.status),
      payload: request.payload ?? {},
      approverId: request.approverId?.toString?.() ?? null,
      cancellationReason: request.cancellationReason ?? null,
      submittedAt: request.submittedAt ?? null,
      decidedAt: request.decidedAt ?? null,
      cancelledAt: request.cancelledAt ?? null,
      approvalStep: request.approvalStep ?? 0,
      approvalChain: (request.approvalChain ?? []).map((step) => ({
        step: step.step,
        approverId: step.approverId?.toString?.() ?? step.approverId,
        status: mapApiStatus(step.status),
      })),
      // FR-002: the embedded approval structure (target, assignment, snapshot).
      approval: request.approval
        ? {
            targetType: request.approval.targetType ?? null,
            targetRoleId: request.approval.targetRoleId?.toString?.() ?? null,
            targetUserId: request.approval.targetUserId?.toString?.() ?? null,
            assignedUserId: request.approval.assignedUserId?.toString?.() ?? null,
            assignedAt: request.approval.assignedAt ?? null,
            status: request.approval.status ?? null,
            approvedBy: request.approval.approvedBy?.toString?.() ?? null,
            approvedAt: request.approval.approvedAt ?? null,
            rejectedBy: request.approval.rejectedBy?.toString?.() ?? null,
            rejectedAt: request.approval.rejectedAt ?? null,
            rejectionReason: request.approval.rejectionReason ?? null,
            configurationSnapshot: request.approval.configurationSnapshot ?? null,
          }
        : null,
      decision: request.decision
        ? {
            action: request.decision.action,
            actorId: request.decision.actorId?.toString?.() ?? request.decision.actorId,
            comment: request.decision.comment,
            decidedAt: request.decision.decidedAt,
          }
        : null,
      version: request.version,
    };
  }

  /** Serializes history events with the agents.md status vocabulary. */
  toEventDto(event) {
    return {
      id: event.id,
      requestId: event.requestId,
      event: event.event,
      actorId: event.actorId?.toString?.() ?? null,
      actorNameSnapshot: event.actorNameSnapshot ?? null,
      actorRoleId: event.actorRoleId?.toString?.() ?? null,
      actorRoleNameSnapshot: event.actorRoleNameSnapshot ?? null,
      comment: event.comment ?? "",
      fromStatus: mapApiStatus(event.fromStatus),
      toStatus: mapApiStatus(event.toStatus),
      recordedAt: event.recordedAt,
    };
  }

  /**
   * FR-009: resolves the actor name + role snapshot for a history event so the
   * timeline stays readable after renames/role changes.
   *
   * @param {string} actorId
   */
  async resolveActorSnapshot(actorId) {
    if (!actorId) return { actorNameSnapshot: null, actorRoleId: null, actorRoleNameSnapshot: null };
    const user = await this.userRepository.findById(actorId);
    if (!user) return { actorNameSnapshot: null, actorRoleId: null, actorRoleNameSnapshot: null };
    const roleIds = await this.userRoleRepository.roleIdsForUser(actorId);
    const roles = roleIds.length ? await this.roleRepository.findByIds(roleIds) : [];
    const first = roles[0];
    return {
      actorNameSnapshot: user.name ?? user.username ?? null,
      actorRoleId: first?.id ?? first?._id ?? null,
      actorRoleNameSnapshot: first?.name ?? null,
    };
  }
}

/**
 * Maps the internal status code to the agents.md API vocabulary:
 * internal `PENDING` → API `PENDING_APPROVAL`. Other statuses pass through.
 */
function mapApiStatus(status) {
  return status === "PENDING" ? "PENDING_APPROVAL" : status;
}

/** Compact human-readable summary for a request (FR-037 history surface). */
function summarizeRequest(request, leaveTypeName = null, sicknessTypeName = null) {
  const p = request.payload ?? {};
  if (request.type === "LEAVE") {
    const name = leaveTypeName || p.leaveTypeName || p.leaveType || "";
    return `${name} ${p.startDate ?? ""}–${p.endDate ?? ""}`.trim();
  }
  if (request.type === "OVERTIME") {
    return `Lembur ${p.date ?? ""} (${p.startTime ?? ""}–${p.endTime ?? ""})`.trim();
  }
  if (request.type === "SAKIT") {
    const name = sicknessTypeName || p.sicknessTypeName || "";
    const range =
      p.endDate && p.endDate !== p.startDate
        ? `${p.startDate ?? ""}–${p.endDate ?? ""}`
        : (p.startDate ?? "");
    return `${name} ${range}`.trim();
  }
  if (request.type === "PERMISSION") {
    const range = p.date
      ? p.date
      : `${p.startDate ?? ""}${p.endDate && p.endDate !== p.startDate ? `–${p.endDate}` : ""}`;
    return `Ijin ${range}`.trim();
  }
  return `Perjalanan dinas ke ${p.destination ?? ""}`.trim();
}

/** Display dates for a request history item (FR-037 DTO). */
function requestDates(request) {
  const p = request.payload ?? {};
  if (request.type === "OVERTIME") {
    return { startDate: p.date ?? null, endDate: null };
  }
  return { startDate: p.startDate ?? null, endDate: p.endDate ?? null };
}

module.exports = { RequestService, summarizeRequest, requestDates };
