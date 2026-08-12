/**
 * RoutingService — resolves the approval chain for a request at submission
 * (FR-042 §5.3). Loads the per-type routing rule (stored or default),
 * resolves each level's approver from the reporting line, applies the
 * configured fallback when the primary is unavailable, and returns the ordered
 * chain plus the current step.
 */

const {
  SOURCE_MANAGER_OF_REQUESTER,
  FALLBACK_ACTIVE_HR_ADMIN,
  FALLBACK_SUPER_ADMIN,
  defaultRules,
  validateRoutingRule,
  evaluateChain,
} = require("../domain/approval-routing");

class RoutingService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/routing-rule.repository').RoutingRuleRepository} deps.routingRuleRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ routingRuleRepository, userRepository, roleRepository, userRoleRepository, auditService }) {
    this.routingRuleRepository = routingRuleRepository;
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.auditService = auditService;
  }

  /**
   * Loads the effective rule for a request type (stored rule or default).
   * Returns null when the type has no configured default (e.g. new modules).
   *
   * @param {string} type LEAVE | OVERTIME | TRIP | PERMISSION
   */
  async loadRule(type) {
    const stored = await this.routingRuleRepository.getByType(type);
    if (stored) return stored;
    const defaults = defaultRules();
    return defaults[type] ? validateRoutingRule(defaults[type]) : null;
  }

  /** Current rules for every type (admin surface). */
  async listRules() {
    const all = await this.routingRuleRepository.listAll();
    const defaults = defaultRules();
    return Object.keys(defaults).map((type) => {
      const stored = all.find((rule) => rule.requestType === type);
      return stored ?? defaults[type];
    });
  }

  /**
   * Persists a validated rule set (FR-042 admin surface). Records a
   * SETTINGS.CHANGED audit event for the change.
   *
   * @param {Array<{ requestType: string, levels: object[], fallback: string, enabled: boolean }>} rules
   * @param {object} [actor] { actorId, actorRoleKeys, correlationId, ip, userAgent }
   */
  async saveRules(rules, actor = {}) {
    const validated = rules.map((rule) => validateRoutingRule(rule));
    for (const rule of validated) {
      await this.routingRuleRepository.upsert(rule, actor.actorId ?? null);
    }

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: "approval-routing", summary: "approval-routing" },
      outcome: "SUCCESS",
      metadata: { setting: "approval-routing", rules: validated },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.listRules();
  }

  /**
   * Resolves the approval chain for a submission.
   *
   * @param {string} requesterId
   * @param {string} type
   * @returns {Promise<{ chain: string[], approverId: string|null, step: number, rule: object }>}
   */
  async resolveChain(requesterId, type) {
    const requester = await this.userRepository.findById(requesterId);
    const rule = await this.loadRule(type);

    // No rule configured for this type (e.g. a newly added module): resolve
    // nothing here; the caller falls back to its legacy approver resolution.
    if (!rule) {
      return { chain: [], approverId: null, step: 0, rule: null };
    }

    if (!rule.enabled) {
      return { chain: [], approverId: null, step: 0, rule };
    }

    const fallbackId = await this.resolveFallback(rule, requester);
    const chain = await evaluateChain(
      rule,
      (source) => this.resolveApproverForSource(source, requester),
      fallbackId
    );

    return { chain, approverId: chain[0] ?? null, step: 0, rule };
  }

  /** Resolves a level source to an ACTIVE approver id (or null). */
  async resolveApproverForSource(source, requester) {
    if (source !== SOURCE_MANAGER_OF_REQUESTER) return null;
    if (!requester?.managerId) return null;
    const manager = await this.userRepository.findById(requester.managerId);
    return manager && manager.status === "ACTIVE" ? manager.id : null;
  }

  /** Resolves the configured fallback to the first ACTIVE holder. */
  async resolveFallback(rule, requester) {
    const targetKey =
      rule.fallback === FALLBACK_SUPER_ADMIN ? FALLBACK_SUPER_ADMIN : FALLBACK_ACTIVE_HR_ADMIN;
    const role = await this.roleRepository.findByKey(targetKey);
    if (!role) return null;
    const holders = await this.userRoleRepository.userIdsForRole(role.id);
    for (const holderId of holders) {
      if (requester && String(holderId) === String(requester.id)) continue;
      const holder = await this.userRepository.findById(holderId);
      if (holder && holder.status === "ACTIVE") return holder.id;
    }
    return null;
  }
}

module.exports = { RoutingService };
