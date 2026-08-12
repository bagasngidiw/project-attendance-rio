/**
 * EscalationService (FR-009) — surfaces stale PENDING requests. A scheduled
 * sweep (checkPendingRequests) audits every request whose submission is older
 * than `escalationConfig.maxPendingDays` and optionally notifies the assigned
 * approver. Config is a platform setting guarded by platform:settings in the
 * route layer and recorded as SETTINGS.CHANGED.
 */

const { ValidationError, ConflictError } = require("../domain/errors");
const { DEFAULT_ESCALATION_POLICY } = require("../domain/approval-policy");

const DEFAULT_CONFIG = Object.freeze({ maxPendingDays: 3, notifyApprover: true });
const SETTING_KEY = "escalationConfig";
const DAY_MS = 24 * 60 * 60 * 1000;

class EscalationService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/request-event.repository').RequestEventRepository} deps.requestEventRepository
   * @param {import('../infrastructure/repositories/escalation.repository').EscalationRepository} [deps.escalationRepository]
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   */
  constructor({ platformSettingRepository, requestRepository, requestEventRepository, escalationRepository, auditService, eventBus }) {
    this.platformSettingRepository = platformSettingRepository;
    this.requestRepository = requestRepository;
    this.requestEventRepository = requestEventRepository;
    this.escalationRepository = escalationRepository ?? null;
    this.auditService = auditService;
    this.eventBus = eventBus;
  }

  /** Current escalation config with defaults applied. */
  async getConfig() {
    const stored = await this.platformSettingRepository.get(SETTING_KEY);
    return {
      maxPendingDays: stored?.maxPendingDays ?? DEFAULT_CONFIG.maxPendingDays,
      notifyApprover: stored?.notifyApprover ?? DEFAULT_CONFIG.notifyApprover,
    };
  }

  /**
   * Persists a validated escalation config and audits the change.
   *
   * @param {{ maxPendingDays: number, notifyApprover?: boolean }} config
   * @param {object} actor
   */
  async updateConfig(config, actor = {}) {
    this.validateConfig(config);
    const oldValue = await this.platformSettingRepository.get(SETTING_KEY);
    const normalized = {
      maxPendingDays: config.maxPendingDays,
      notifyApprover: config.notifyApprover ?? true,
    };

    await this.platformSettingRepository.set(SETTING_KEY, normalized, actor.actorId ?? null);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: SETTING_KEY, summary: SETTING_KEY },
      outcome: "SUCCESS",
      metadata: { setting: SETTING_KEY, oldValue: oldValue ?? null, newValue: normalized },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { key: SETTING_KEY, value: normalized };
  }

  validateConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new ValidationError("escalationConfig must be an object.", {
        field: SETTING_KEY,
      });
    }
    if (!Number.isInteger(config.maxPendingDays) || config.maxPendingDays < 1) {
      throw new ValidationError(
        "maxPendingDays must be a positive integer.",
        { field: "maxPendingDays" }
      );
    }
    if (config.notifyApprover !== undefined && typeof config.notifyApprover !== "boolean") {
      throw new ValidationError("notifyApprover must be a boolean.", {
        field: "notifyApprover",
      });
    }
  }

  /**
   * Sweeps PENDING requests submitted longer than `maxPendingDays` ago. Each
   * stale request is audited (ESCALATION.TRIGGERED); when notifyApprover is
   * enabled and an approver is assigned, a request.escalated event is emitted.
   *
   * @param {Date} [now] injectable clock for deterministic tests
   * @returns {Promise<{ count: number, items: Array<{ requestId: string, type: string, approverId: string|null, daysPending: number }> }>}
   */
  async checkPendingRequests(now = new Date()) {
    const config = await this.getConfig();
    const threshold = new Date(now.getTime() - config.maxPendingDays * DAY_MS);
    const { items } = await this.requestRepository.findWithFilters({
      status: "PENDING",
      to: threshold,
    });

    const escalated = [];
    for (const request of items) {
      const submittedAt = request.submittedAt ? new Date(request.submittedAt) : now;
      const daysPending = Math.max(
        0,
        Math.floor((now.getTime() - submittedAt.getTime()) / DAY_MS)
      );
      const requestId = String(request.id ?? request._id);

      await this.auditService.record({
        action: "ESCALATION.TRIGGERED",
        actor: { userId: null, roleKeys: [] },
        subject: { type: "REQUEST", id: requestId, summary: `${request.type} escalated` },
        outcome: "SUCCESS",
        metadata: {
          requestId,
          type: request.type,
          requesterId: request.requesterId,
          daysPending,
        },
        correlationId: "",
        ip: "",
        userAgent: "",
      });

      if (config.notifyApprover !== false && request.approverId) {
        await this.eventBus.publish("request.escalated", {
          requestId,
          type: request.type,
          requesterId: request.requesterId,
          approverId: request.approverId,
        });
      }

      escalated.push({
        requestId,
        type: request.type,
        approverId: request.approverId ?? null,
        daysPending,
      });
    }

    return { count: escalated.length, items: escalated };
  }

  /**
   * FR-063: records a requester/approver escalation of a PENDING request.
   * Escalation is notification-only — the request status is unchanged and no
   * approval step is created. The request is rate-limited per the escalation
   * policy (defaults: max 3 per 24h). History + audit + request.escalated
   * event are always recorded.
   *
   * @param {{ request: object, escalatorId: string, message?: string, actor?: object, now?: Date }} input
   */
  async recordEscalation({ request, escalatorId, message = "", actor = {}, now = new Date() }) {
    const policy = DEFAULT_ESCALATION_POLICY;
    const windowMs = policy.escalationRateLimit.windowMs;
    const max = policy.escalationRateLimit.max;
    const requestId = String(request.id ?? request._id);

    if (this.escalationRepository && max > 0) {
      const since = new Date(now.getTime() - windowMs);
      const recent = await this.escalationRepository.countByRequestSince(requestId, since);
      if (recent >= max) {
        throw new ConflictError(
          "This request has been escalated too many times recently. Try again later.",
          "ESCALATION_RATE_LIMITED"
        );
      }
      await this.escalationRepository.create({
        requestId,
        escalatorId,
        message,
        targetRoleLevel: null,
      });
    }

    // Append-only request history event.
    if (this.requestEventRepository) {
      await this.requestEventRepository.append({
        requestId,
        event: "ESCALATED",
        actorId: escalatorId,
        comment: message,
        fromStatus: request.status,
        toStatus: request.status,
      });
    }

    await this.auditService.record({
      action: "REQUEST.ESCALATED",
      actor: { userId: escalatorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "REQUEST", id: requestId, summary: `${request.type} escalated` },
      outcome: "SUCCESS",
      metadata: {
        requestId,
        type: request.type,
        requesterId: request.requesterId,
        message: message ?? "",
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    await this.eventBus.publish("request.escalated", {
      requestId,
      type: request.type,
      requesterId: request.requesterId,
      approverId: request.approverId,
      message,
    });
  }
}

module.exports = { EscalationService };
