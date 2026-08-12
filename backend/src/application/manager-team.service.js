/**
 * ManagerTeamService — Manager team overview (FR-006).
 *
 * Resolves a Manager's direct reports (reporting structure stored on the User
 * aggregate as `managerId`), enriches each member with their role keys, and
 * computes a pending-request summary across HR modules.
 *
 * Data authorization: every lookup is scope-bound. `getTeamMember` returns the
 * member ONLY when they are an ACTIVE direct report of the acting manager;
 * anyone else is answered as if they do not exist (404), so scope violations
 * never leak employee existence.
 */

const { NotFoundError } = require("../domain/errors");
const { isWithinTeamScope } = require("../domain/model");

class ManagerTeamService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../application/pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('../application/audit.service').AuditService} deps.auditService
   */
  constructor({
    userRepository,
    userRoleRepository,
    roleRepository,
    pendingSummaryService,
    auditService,
  }) {
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
    this.roleRepository = roleRepository;
    this.pendingSummaryService = pendingSummaryService;
    this.auditService = auditService;
  }

  /**
   * Team overview for the acting manager: manager identity, ACTIVE direct
   * reports with their role keys, and aggregate pending-request counts.
   *
   * @param {string} managerId
   * @param {{ actorRoleKeys?: string[], correlationId?: string, ip?: string, userAgent?: string }} [ctx]
   */
  async getTeamOverview(managerId, ctx = {}) {
    const manager = await this.userRepository.assertExists(managerId);

    const members = await this.userRepository.findDirectReports(managerId);
    const enrichedMembers = await Promise.all(
      members.map((member) => this.toMemberDto(member))
    );

    const pendingSummary = await this.pendingSummaryService.getPendingSummary(
      enrichedMembers.map((member) => member.id)
    );

    await this.recordTeamView(managerId, ctx, enrichedMembers.length);

    return {
      manager: {
        id: manager.id,
        username: manager.username,
        email: manager.email,
        name: manager.name,
      },
      members: enrichedMembers,
      pendingSummary,
      memberCount: enrichedMembers.length,
    };
  }

  /**
   * Scope-bound member lookup. Throws NotFoundError for any user who is not an
   * ACTIVE direct report of the acting manager (no existence leak).
   *
   * @param {string} managerId
   * @param {string} memberId
   * @param {{ actorRoleKeys?: string[], correlationId?: string, ip?: string, userAgent?: string }} [ctx]
   */
  async getTeamMember(managerId, memberId, ctx = {}) {
    const member = await this.userRepository.findDirectReportById(
      managerId,
      memberId
    );
    if (!member) {
      throw new NotFoundError("Team member not found.", "TEAM_MEMBER_NOT_FOUND");
    }

    await this.auditService.record({
      action: "TEAM.VIEWED",
      actor: { userId: managerId, roleKeys: ctx.actorRoleKeys ?? [] },
      subject: { type: "USER", id: member.id, summary: member.username },
      outcome: "SUCCESS",
      metadata: { scope: "team-member" },
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.toMemberDto(member);
  }

  /**
   * Domain helper: exposes the reporting-scope predicate for downstream
   * consumers (e.g. approval inbox FR-007) without duplicating the rule.
   */
  isWithinScope(memberManagerId, managerId) {
    return isWithinTeamScope(memberManagerId, managerId);
  }

  async toMemberDto(member) {
    const roles = await this.loadRoleKeys(member.id);
    return {
      id: member.id,
      username: member.username,
      email: member.email,
      name: member.name,
      status: member.status,
      departmentId: member.departmentId ?? null,
      positionId: member.positionId ?? null,
      managerId: member.managerId ?? null,
      roles,
    };
  }

  async loadRoleKeys(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    const roles = await this.roleRepository.findByIds(roleIds);
    return roles.map((role) => role.key);
  }

  async recordTeamView(managerId, ctx, memberCount) {
    await this.auditService.record({
      action: "TEAM.VIEWED",
      actor: { userId: managerId, roleKeys: ctx.actorRoleKeys ?? [] },
      subject: { type: "TEAM", id: managerId },
      outcome: "SUCCESS",
      metadata: { scope: "team-overview", memberCount },
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}

module.exports = { ManagerTeamService };
