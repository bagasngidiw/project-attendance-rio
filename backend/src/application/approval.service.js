/**
 * ApprovalService — the approver side of the request lifecycle (FR-007 /
 * FR-008 / FR-063).
 *
 * FR-063 (unified single-approver workflow):
 *   - One decision (approve OR reject) finalizes a request. Multi-level
 *     chaining is removed; `advanceLevel` is retained only for history.
 *   - The rejection reason field is always optional; blank values are stored
 *     as "" and the UI renders "No reason provided".
 *   - Cutoff/calendar rules may block approval; authorized actors with
 *     `platform:override_cutoff` may override (audited).
 *   - Requesters (and approvers) may escalate PENDING requests; escalation is
 *     notification-only and never creates an approval step.
 *   - Delegated approvers decide in the approver's stead and the decision is
 *     recorded with delegation context.
 */

const {
  REQUEST_STATUS,
  assertNoSelfApproval,
} = require("../domain/request");
const {
  normalizeDecisionComment,
  canEscalate,
  normalizeCutoffRule,
} = require("../domain/approval-policy");
const { hasPermission } = require("../domain/permissions");
const {
  NotFoundError,
  ValidationError,
  PermissionDeniedError,
  ConflictError,
} = require("../domain/errors");

class ApprovalService {
  /**
   * @param {object} deps
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/request-event.repository').RequestEventRepository} deps.requestEventRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   * @param {object} deps.config security config (approvals)
   * @param {object} [deps.delegationService] FR-009 delegation hook
   * @param {object} [deps.cutoffRuleRepository] FR-063 cutoff/calendar blocks
   * @param {object} [deps.calendarService] FR-063 company calendar adapter
   * @param {object} [deps.escalationService] FR-063 requester escalation
   * @param {object} [deps.userRepository] for requester/approver username display
   */
  constructor({
    requestService,
    requestRepository,
    requestEventRepository,
    auditService,
    eventBus,
    config,
    delegationService,
    cutoffRuleRepository,
    calendarService,
    escalationService,
    userRepository,
  }) {
    this.requestService = requestService;
    this.requestRepository = requestRepository;
    this.requestEventRepository = requestEventRepository;
    this.auditService = auditService;
    this.eventBus = eventBus;
    this.config = config;
    this.delegationService = delegationService ?? null;
    this.cutoffRuleRepository = cutoffRuleRepository ?? null;
    this.calendarService = calendarService ?? null;
    this.escalationService = escalationService ?? null;
    this.userRepository = userRepository ?? null;
  }

  /**
   * Enriches a request DTO with the requester/approver usernames so the UI can
   * show names instead of raw ObjectIds (best-effort: null when unresolved).
   */
  async enrichNames(dto) {
    if (!this.userRepository) return dto;
    const [requester, approver] = await Promise.all([
      dto.requesterId ? this.userRepository.findById(dto.requesterId) : null,
      dto.approverId ? this.userRepository.findById(dto.approverId) : null,
    ]);
    return {
      ...dto,
      requesterName: requester?.username ?? null,
      approverName: approver?.username ?? null,
    };
  }

  /**
   * Approval inbox: PENDING requests assigned to the caller (FR-007 §5.1).
   *
   * @param {string} approverId
   * @param {{ type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async listInbox(approverId, filters = {}) {
    const { items, total } = await this.requestRepository.findByApprover(approverId, {
      status: REQUEST_STATUS.PENDING,
      ...filters,
    });
    const enriched = await Promise.all(
      items.map((item) => this.enrichNames(this.requestService.toDto(item)))
    );
    return {
      items: enriched,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /**
   * Unified approval list (FR-063 U.4 GET /approvals): PENDING requests in the
   * caller's scope — assigned to them, delegated to them, or (when they hold a
   * `*:view_all` permission) all in-scope requests. Filters: type, status,
   * employee, date range.
   *
   * @param {object} actor
   * @param {{ type?: string, status?: string, employeeId?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async listUnified(actor = {}, filters = {}) {
    const delegatedIds = await this.resolveDelegatedApproverIds(actor.actorId);
    const seesAll =
      (actor.actorPermissions ?? []).includes("*") ||
      ["leave", "trip", "overtime", "permission", "sakit"].some((t) =>
        hasPermission(actor.actorPermissions ?? [], `${t}:view_all`)
      );

    const approverFilter = seesAll
      ? undefined
      : { $in: [actor.actorId, ...delegatedIds] };

    const { items, total } = await this.requestRepository.findWithFilters({
      approverId: approverFilter,
      status: filters.status ?? REQUEST_STATUS.PENDING,
      type: filters.type ? filters.type.toUpperCase() : undefined,
      from: filters.from,
      to: filters.to,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
      extra: filters.employeeId
        ? { requesterId: filters.employeeId }
        : undefined,
    });

    const enriched = await Promise.all(
      items.map((item) => this.enrichNames(this.requestService.toDto(item)))
    );

    return {
      items: enriched,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /**
   * Unified decision history (FR-063 GET /approvals/history): decided requests
   * visible per the caller's scope.
   *
   * @param {object} actor
   * @param {{ type?: string, page?: number, pageSize?: number }} filters
   */
  async listHistoryUnified(actor = {}, filters = {}) {
    const seesAll =
      (actor.actorPermissions ?? []).includes("*") ||
      ["leave", "trip", "overtime", "permission", "sakit"].some((t) =>
        hasPermission(actor.actorPermissions ?? [], `${t}:view_all`)
      );

    if (!seesAll) {
      return this.listHistory(actor.actorId, filters);
    }
    const { items, total } = await this.requestRepository.findWithFilters({
      status: { $in: [REQUEST_STATUS.APPROVED, REQUEST_STATUS.REJECTED] },
      type: filters.type ? filters.type.toUpperCase() : undefined,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
      field: "decidedAt",
    });
    const enriched = await Promise.all(
      items.map((item) => this.enrichNames(this.requestService.toDto(item)))
    );
    return {
      items: enriched,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /** Resolves the set of approver ids currently delegating TO the actor. */
  async resolveDelegatedApproverIds(actorId) {
    if (!this.delegationService) return [];
    const delegations = await this.delegationService.listDelegationsForDelegate(actorId);
    return delegations.map((d) => String(d.delegatorId));
  }

  /**
   * Approval history: requests decided by the caller (FR-008).
   *
   * @param {string} actorId
   * @param {{ type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async listHistory(actorId, filters = {}) {
    const { items, total } = await this.requestRepository.findByDecidedBy(actorId, filters);
    const enriched = await Promise.all(
      items.map((item) => this.enrichNames(this.requestService.toDto(item)))
    );
    return {
      items: enriched,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /**
   * Request drill-down (FR-063 GET /approvals/:id): payload + history, visible
   * to the requester, assigned approver, effective delegate, or admins.
   *
   * @param {string} requestId
   * @param {object} actor
   */
  async getDrillDown(requestId, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    await this.assertCanView(request, actor);
    const events = await this.requestEventRepository.findByRequestId(requestId);
    return { request: await this.enrichNames(this.requestService.toDto(request)), events: events.map((e) => this.requestService.toEventDto(e)) };
  }

  /** True when the actor may view/decide the given request (no existence leak). */
  async assertCanView(request, actor) {
    const isRequester = String(request.requesterId) === String(actor.actorId);
    const isApprover = String(request.approverId) === String(actor.actorId);
    const isAdmin =
      (actor.actorRoleKeys ?? []).includes("HR_ADMIN") ||
      (actor.actorRoleKeys ?? []).includes("SUPER_ADMIN");

    // A role-targeted request awaiting claim is visible to any eligible
    // approver who holds the type's approve permission — consistent with the
    // unified list (they can open what they can claim). Claiming and deciding
    // keep their own stricter assignment checks.
    const isEligibleClaimViewer =
      request.status === REQUEST_STATUS.PENDING &&
      request.approval?.targetType === "ROLE" &&
      !request.approval?.assignedUserId &&
      hasPermission(actor.actorPermissions ?? [], `${request.type.toLowerCase()}:approve`);

    let isEffectiveDelegate = false;
    if (this.delegationService && !isApprover) {
      const effective = await this.delegationService.resolveEffectiveApprover({
        approverId: request.approverId,
        requestType: request.type,
        date: new Date(),
      });
      isEffectiveDelegate =
        effective?.delegated &&
        String(effective.effectiveApproverId) === String(actor.actorId);
    }

    if (!isRequester && !isApprover && !isEffectiveDelegate && !isAdmin && !isEligibleClaimViewer) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
  }

  /**
   * Decides a request (approve/reject). A single decision finalizes the
   * request — no sequential steps (FR-063). The rejection reason is optional.
   * Cutoff/calendar rules block decisions unless the actor may override.
   *
   * @param {string} requestId
   * @param {{ decision: string, comment?: string, overrideCutoff?: boolean }} input
   * @param {object} actor { actorId, actorRoleKeys, actorPermissions, correlationId, ip, userAgent }
   */
  async decide(requestId, { decision, comment = "", overrideCutoff = false }, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    // Data scope: only the assigned approver (or effective delegate) may decide.
    let delegatedDecision = false;
    if (String(request.approverId) !== String(actor.actorId)) {
      const effective = this.delegationService
        ? await this.delegationService.resolveEffectiveApprover({
            approverId: request.approverId,
            requestType: request.type,
            date: new Date(),
          })
        : null;
      const isEffectiveDelegate =
        effective?.delegated &&
        String(effective.effectiveApproverId) === String(actor.actorId);
      if (!isEffectiveDelegate) {
        throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
      }
      delegatedDecision = true;
    }

    // No self-approval (FR-057 foundation).
    assertNoSelfApproval(request.requesterId, actor.actorId);

    // Permission for the request's type (defense in depth behind the route gate).
    const permissionKey = `${request.type.toLowerCase()}:approve`;
    if (!hasPermission(actor.actorPermissions ?? [], permissionKey)) {
      throw new PermissionDeniedError(permissionKey);
    }

    // Cutoff/calendar block (FR-063 U.5.5). Overrides are audited.
    const block = await this.resolveBlock(request, new Date());
    if (block.blocked && !overrideCutoff) {
      throw new ConflictError(block.reason, "APPROVAL_BLOCKED");
    }
    const cutoffOverridden = block.blocked && overrideCutoff;
    if (cutoffOverridden) {
      await this.auditService.record({
        action: "APPROVAL.OVERRIDE",
        actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "REQUEST", id: request.id, summary: `${request.type} override` },
        outcome: "SUCCESS",
        metadata: { requestId: request.id, type: request.type, reason: block.reason },
        correlationId: actor.correlationId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    const normalizedDecision =
      decision === REQUEST_STATUS.REJECTED
        ? REQUEST_STATUS.REJECTED
        : REQUEST_STATUS.APPROVED;

    // FR-002/agents.md §16/§29: the rejection reason is MANDATORY. (This
    // overrides the earlier FR-063 optional behavior per the revamp blueprint.)
    if (normalizedDecision === REQUEST_STATUS.REJECTED && !String(comment ?? "").trim()) {
      throw new ValidationError("A rejection reason is required.", {
        field: "comment",
      });
    }

    // FR-063 U.6: the comment is stored as provided (never blank for rejects).
    const storedComment = normalizeDecisionComment(comment);

    const decided = await this.requestService.transition({
      requestId,
      toStatus: normalizedDecision,
      actor,
      comment: storedComment,
    });

    // Record delegation context when the decision was made by a delegate.
    if (delegatedDecision) {
      await this.auditService.record({
        action: "APPROVAL.DELEGATED",
        actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "REQUEST", id: request.id, summary: "delegated decision" },
        outcome: "SUCCESS",
        metadata: { requestId: request.id, assignedApproverId: request.approverId, decidedBy: actor.actorId },
        correlationId: actor.correlationId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    return this.requestService.toDto(decided);
  }

  /**
   * Evaluates cutoff/calendar blocks for a request.
   *
   * @returns {Promise<{ blocked: boolean, reason?: string, rule?: object }>}
   */
  async resolveBlock(request, now) {
    if (!this.cutoffRuleRepository) return { blocked: false };
    const rule =
      (await this.cutoffRuleRepository.getByType(request.type)) ??
      (await this.cutoffRuleRepository.getByType("*")) ??
      null;
    if (!rule) return { blocked: false };
    const normalized = normalizeCutoffRule(rule);
    const calendar = this.calendarService
      ? { isWorkingDay: (d) => this.calendarService.isWorkingDay(d) }
      : {};
    return isApprovalBlockedCompat(normalized, now, calendar);
  }

  /**
   * FR-063 GET /approvals/blocked-reason/:id — the cutoff/calendar block
   * reason for a request (UI shows a clear message).
   *
   * @returns {Promise<{ blocked: boolean, reason?: string }>}
   */
  async getBlockedReason(requestId, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    await this.assertCanView(request, actor);
    return this.resolveBlock(request, new Date());
  }

  /**
   * FR-063 POST /approvals/:id/escalate — requester (or any *:approve holder)
   * escalates a PENDING request. Escalation never changes status or creates an
   * approval step; it notifies a higher-level role and records history + audit.
   * Rate-limited by the escalation service.
   *
   * @param {string} requestId
   * @param {{ message?: string }} input
   * @param {object} actor
   */
  async escalate(requestId, { message = "" }, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    const isRequester = String(request.requesterId) === String(actor.actorId);
    const hasApprovePower = ["leave", "trip", "overtime", "permission", "sakit"].some((t) =>
      hasPermission(actor.actorPermissions ?? [], `${t}:approve`)
    );
    if (!isRequester && !hasApprovePower) {
      throw new PermissionDeniedError("leave:approve");
    }

    const policy = { allowEscalation: true };
    const eligibility = canEscalate(request, policy);
    if (!eligibility.canEscalate) {
      throw new ConflictError(eligibility.reason ?? "Escalation is not allowed.", "ESCALATION_BLOCKED");
    }

    if (this.escalationService) {
      await this.escalationService.recordEscalation({
        request,
        escalatorId: actor.actorId,
        message,
        actor,
      });
    } else {
      // No escalation service wired: still record history + audit so the
      // escalation is observable.
      await this.requestEventRepository.append({
        requestId: request.id,
        event: "ESCALATED",
        actorId: actor.actorId,
        comment: message,
        fromStatus: request.status,
        toStatus: request.status,
      });
      await this.auditService.record({
        action: "REQUEST.ESCALATED",
        actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "REQUEST", id: request.id, summary: `${request.type} escalated` },
        outcome: "SUCCESS",
        metadata: { requestId: request.id, type: request.type, message },
        correlationId: actor.correlationId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      await this.eventBus.publish("request.escalated", {
        requestId: request.id,
        type: request.type,
        requesterId: request.requesterId,
        approverId: request.approverId,
      });
    }

    return { ok: true, requestId: request.id, status: this.requestService.toDto(request).status };
  }

  /**
   * History timeline for a request, visible to the requester, the assigned
   * approver, or HR/SUPER admins (FR-008). Others get 404.
   *
   * @param {string} requestId
   * @param {object} actor
   */
  async getHistoryScoped(requestId, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    await this.assertCanView(request, actor);
    const events = await this.requestEventRepository.findByRequestId(requestId);
    return { request: await this.enrichNames(this.requestService.toDto(request)), events: events.map((e) => this.requestService.toEventDto(e)) };
  }

  /**
   * Legacy multi-level advancement — RETAINED FOR HISTORY ONLY. The unified
   * single-approver workflow (FR-063) never calls this; validated routing
   * rules contain exactly one level so `hasMoreLevels` is always false.
   *
   * @deprecated FR-063
   */
  async advanceLevel(request, actor, comment) {
    const completedStep = request.approvalStep;
    const nextStep = completedStep + 1;
    const nextApproverId = request.approvalChain[nextStep].approverId;
    const stepComment = comment || `Approved at level ${completedStep + 1}.`;

    await this.requestEventRepository.append({
      requestId: request.id,
      event: "APPROVED",
      actorId: actor.actorId,
      comment: stepComment,
      fromStatus: REQUEST_STATUS.PENDING,
      toStatus: REQUEST_STATUS.PENDING,
    });

    const updated = await this.requestRepository.updateStatus(request.id, {
      toStatus: REQUEST_STATUS.PENDING,
      version: request.version,
      fields: { approvalStep: nextStep, approverId: nextApproverId },
    });

    await this.eventBus.publish("request.decided", {
      requestId: request.id,
      type: request.type,
      requesterId: request.requesterId,
      toStatus: "APPROVED",
      step: true,
      comment: stepComment,
    });

    return this.requestService.toDto(updated);
  }
}

/**
 * FR-063 cutoff evaluation. Imported lazily to avoid a circular dependency at
 * module load; the domain function itself is pure.
 */
function isApprovalBlockedCompat(normalizedRule, now, calendar) {
  // eslint-disable-next-line global-require
  const { isApprovalBlocked } = require("../domain/approval-policy");
  return isApprovalBlocked({}, now, normalizedRule, calendar);
}

module.exports = { ApprovalService };
