/**
 * CutoffRuleService (FR-063 U.6) — manages cutoff/calendar approval blocks.
 *
 * Cutoff rules are platform configuration: they restrict WHEN approvals can
 * happen per request type. All writes are audited (SETTINGS.CHANGED). The
 * approval pipeline evaluates the rule via `approval-policy.isApprovalBlocked`.
 */

const { normalizeCutoffRule } = require("../domain/approval-policy");
const { ValidationError, NotFoundError } = require("../domain/errors");

const CUTOFF_TYPES = Object.freeze(["LEAVE", "TRIP", "OVERTIME", "*"]);

class CutoffRuleService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/cutoff-rule.repository').CutoffRuleRepository} deps.cutoffRuleRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ cutoffRuleRepository, auditService }) {
    this.cutoffRuleRepository = cutoffRuleRepository;
    this.auditService = auditService;
  }

  /** All configured rules. */
  async listRules() {
    return this.cutoffRuleRepository.listAll();
  }

  /**
   * Creates or replaces a rule for a request type (audited).
   *
   * @param {{ requestType: string, days?: number[], fromTime?: string, toTime?: string, timezone?: string, dependsOn?: string, enabled?: boolean }} input
   * @param {object} actor
   */
  async upsertRule(input, actor = {}) {
    if (!CUTOFF_TYPES.includes(input.requestType)) {
      throw new ValidationError(
        `requestType must be one of ${CUTOFF_TYPES.join(", ")}.`,
        { field: "requestType" }
      );
    }
    const normalized = normalizeCutoffRule(input);

    const old = await this.cutoffRuleRepository.getByType(input.requestType);
    const saved = await this.cutoffRuleRepository.upsert(normalized, actor.actorId ?? null);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "CUTOFF_RULE", id: input.requestType, summary: `${input.requestType} cutoff rule` },
      outcome: "SUCCESS",
      metadata: {
        setting: "cutoffRule",
        requestType: input.requestType,
        oldValue: old ?? null,
        newValue: normalized,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(saved);
  }

  /** Deletes a rule (audited). */
  async deleteRule(requestType, actor = {}) {
    if (!CUTOFF_TYPES.includes(requestType)) {
      throw new ValidationError(`Unknown request type "${requestType}".`, {
        field: "requestType",
      });
    }
    const existing = await this.cutoffRuleRepository.getByType(requestType);
    if (!existing) {
      throw new NotFoundError("Cutoff rule not found.", "CUTOFF_RULE_NOT_FOUND");
    }
    await this.cutoffRuleRepository.deleteByType(requestType);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "CUTOFF_RULE", id: requestType, summary: `${requestType} cutoff rule removed` },
      outcome: "SUCCESS",
      metadata: { setting: "cutoffRule", requestType, removed: true },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { removed: true, requestType };
  }

  toDto(rule) {
    return {
      requestType: rule.requestType,
      days: rule.days ?? [],
      fromTime: rule.fromTime ?? "",
      toTime: rule.toTime ?? "",
      timezone: rule.timezone ?? "",
      dependsOn: rule.dependsOn ?? "",
      enabled: rule.enabled !== false,
      updatedAt: rule.updatedAt ?? null,
    };
  }
}

module.exports = { CutoffRuleService };
