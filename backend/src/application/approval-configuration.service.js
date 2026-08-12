/**
 * ApprovalConfigurationService (FR-001) — the Superadmin surface for the
 * approval configuration and the eligibility queries used by target resolution
 * (FR-003) and the approval engine (FR-002).
 *
 * Every configuration mutation is audited (APPROVAL_CONFIG_UPDATED). Roles are
 * always resolved from the RBAC database; role names are never hardcoded.
 */

const {
  CONFIG_REQUEST_TYPES,
  defaultConfiguration,
  validateConfiguration,
  canApproveEntry,
  canBeTargetEntry,
  buildSnapshot,
} = require("../domain/approval-configuration");
const { ValidationError, NotFoundError } = require("../domain/errors");

class ApprovalConfigurationService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/approval-configuration.repository').ApprovalConfigurationRepository} deps.approvalConfigurationRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    approvalConfigurationRepository,
    roleRepository,
    userRoleRepository,
    userRepository,
    auditService,
  }) {
    this.approvalConfigurationRepository = approvalConfigurationRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.userRepository = userRepository;
    this.auditService = auditService;
  }

  /** All configurations (defaults materialized for unconfigured types). */
  async getConfigurations() {
    const stored = await this.approvalConfigurationRepository.listAll();
    const byType = new Map(stored.map((c) => [c.requestType, c]));
    return CONFIG_REQUEST_TYPES.map((requestType) => {
      const config = byType.get(requestType);
      return config ?? defaultConfiguration(requestType);
    });
  }

  /** Single configuration with a fallback to the default (empty) shape. */
  async getConfiguration(requestType) {
    this.assertRequestType(requestType);
    const stored = await this.approvalConfigurationRepository.getByType(requestType);
    return stored ?? defaultConfiguration(requestType);
  }

  /**
   * Validates + persists a configuration. Role entries must reference existing
   * ACTIVE roles. The change is audited with the old + new value.
   *
   * @param {string} requestType
   * @param {{ roles: Array<{ roleId: string, approvalLevel: number, canApprove?: boolean, canBeTarget?: boolean }>, selfApproval?: boolean, expectedVersion?: number }} input
   * @param {object} actor
   */
  async updateConfiguration(requestType, input, actor = {}) {
    this.assertRequestType(requestType);
    const validated = validateConfiguration({
      requestType,
      roles: input.roles,
      selfApproval: input.selfApproval,
    });

    // Resolve + validate role references (active, existing).
    const roleIds = validated.roles.map((r) => r.roleId);
    const roles = roleIds.length ? await this.roleRepository.findByIds(roleIds) : [];
    const activeById = new Map(
      roles.map((r) => [String(r.id ?? r._id), r])
    );
    for (const entry of validated.roles) {
      const role = activeById.get(String(entry.roleId));
      if (!role || role.status !== "ACTIVE") {
        throw new ValidationError(
          `Configured role ${entry.roleId} does not exist or is not active.`,
          { field: "roles" }
        );
      }
    }

    const oldValue = await this.approvalConfigurationRepository.getByType(requestType);
    const saved = await this.approvalConfigurationRepository.upsert(
      { ...validated, expectedVersion: input.expectedVersion },
      actor.actorId ?? null
    );

    await this.auditService.record({
      action: "APPROVAL_CONFIG_UPDATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "APPROVAL_CONFIG", id: requestType, summary: `${requestType} approval configuration` },
      outcome: "SUCCESS",
      metadata: {
        requestType,
        oldValue: oldValue ?? null,
        newValue: {
          requestType: saved.requestType,
          roles: saved.roles,
          selfApproval: saved.selfApproval,
        },
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(saved);
  }

  /**
   * Eligible APPROVE roles for a request type (FR-001 §getEligibleRoles):
   * configured entries with canApprove where the role is still active.
   * The RBAC application permission (`*:approve`) is enforced separately at
   * the route guard and inside the decision service (defense in depth) — the
   * configuration remains the selector's source of truth.
   *
   * @param {string} requestType
   */
  async getEligibleRoles(requestType) {
    const config = await this.getConfiguration(requestType);
    const entries = config.roles.filter(canApproveEntry);
    if (entries.length === 0) return [];

    const roleIds = entries.map((e) => e.roleId);
    const roles = await this.roleRepository.findActiveByIds(roleIds);
    const roleById = new Map(roles.map((r) => [String(r.id ?? r._id), r]));

    return entries
      .filter((entry) => roleById.has(String(entry.roleId)))
      .map((entry) => {
        const role = roleById.get(String(entry.roleId));
        return {
          roleId: String(role.id ?? role._id),
          roleKey: role.key,
          roleName: role.name,
          approvalLevel: entry.approvalLevel,
          canBeTarget: canBeTargetEntry(entry),
        };
      });
  }

  /**
   * Eligible users who may act for a request type (FR-003): ACTIVE users
   * holding an eligible role (optionally narrowed to one roleId).
   *
   * @param {string} requestType
   * @param {string} [roleId]
   */
  async getEligibleUsers(requestType, roleId = null) {
    const eligibleRoles = await this.getEligibleRoles(requestType);
    if (eligibleRoles.length === 0) return [];

    const roleIds = roleId
      ? eligibleRoles.filter((r) => String(r.roleId) === String(roleId)).map((r) => r.roleId)
      : eligibleRoles.map((r) => r.roleId);
    if (roleIds.length === 0) return [];

    // All user→role pairs for the eligible role set, then resolve ACTIVE users.
    const pairs = await this.userRoleRepository.userRolePairsForRoleIds(roleIds);
    const userIds = [...new Set(pairs.map((p) => String(p.userId)))];
    const users = await this.userRepository.findByIdsActive(userIds);
    const activeIds = new Set(users.map((u) => String(u.id ?? u._id)));

    const roleById = new Map(eligibleRoles.map((r) => [String(r.roleId), r]));
    const usersById = new Map(users.map((u) => [String(u.id ?? u._id), u]));
    const seen = new Set();
    const result = [];

    for (const pair of pairs) {
      const uid = String(pair.userId);
      if (!activeIds.has(uid) || seen.has(uid)) continue;
      const role = roleById.get(String(pair.roleId));
      if (!role) continue;
      seen.add(uid);
      const user = usersById.get(uid);
      result.push({
        userId: uid,
        userName: user.name ?? user.username,
        username: user.username,
        roleId: String(role.roleId),
        roleName: role.roleName,
        approvalLevel: role.approvalLevel,
      });
    }
    return result;
  }

  /** FR-001: builds the immutable snapshot stored on the request. */
  buildSnapshot(params) {
    return buildSnapshot(params);
  }

  /** True when self-approval is enabled for a request type (default false). */
  async allowsSelfApproval(requestType) {
    const config = await this.getConfiguration(requestType);
    return config.selfApproval === true;
  }

  assertRequestType(requestType) {
    if (!CONFIG_REQUEST_TYPES.includes(requestType)) {
      throw new NotFoundError(
        `Unknown approval request type "${requestType}".`,
        "APPROVAL_CONFIG_TYPE_NOT_FOUND"
      );
    }
  }

  toDto(config) {
    return {
      requestType: config.requestType,
      roles: (config.roles ?? []).map((r) => ({
        roleId: String(r.roleId ?? r._id),
        approvalLevel: r.approvalLevel,
        canApprove: r.canApprove === true,
        canBeTarget: r.canBeTarget === true,
      })),
      selfApproval: config.selfApproval === true,
      version: config.version ?? 1,
      updatedAt: config.updatedAt ?? null,
    };
  }
}

module.exports = { ApprovalConfigurationService };
