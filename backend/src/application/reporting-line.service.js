/**
 * ReportingLineService — reporting-line management (FR-043).
 *
 * Assigns/reassigns a user's manager (single direct reporting line), appends
 * manager-change history for audit review, records REPORTING.MANAGER_ASSIGNED,
 * and exposes direct reports + history. Self-assignment is blocked and the
 * manager must be an ACTIVE user.
 */

const {
  assertValidManagerAssignment,
} = require("../domain/model");
const { NotFoundError, ConflictError } = require("../domain/errors");

class ReportingLineService {
  /**
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/reporting.repository').ReportingRepository} deps.reportingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ userRepository, reportingRepository, auditService }) {
    this.userRepository = userRepository;
    this.reportingRepository = reportingRepository;
    this.auditService = auditService;
  }

  /**
   * Assigns (or clears) the manager of a user. Appends history and audits the
   * change; the new reporting line immediately affects team scope and routing.
   *
   * @param {string} userId
   * @param {{ managerId?: string|null }} input
   * @param {object} actor
   */
  async assignManager(userId, { managerId = null } = {}, actor = {}) {
    const user = await this.userRepository.assertExists(userId);

    assertValidManagerAssignment({ userId, managerId });
    const normalizedManagerId = managerId || null;

    if (normalizedManagerId) {
      const manager = await this.userRepository.findById(normalizedManagerId);
      if (!manager) {
        throw new NotFoundError("Manager user not found.", "USER_NOT_FOUND");
      }
      if (manager.status !== "ACTIVE") {
        throw new ConflictError(
          "The assigned manager must be an ACTIVE user.",
          "INVALID_MANAGER"
        );
      }
    }

    const oldManagerId = user.managerId ? String(user.managerId) : null;
    if (oldManagerId === (normalizedManagerId ? String(normalizedManagerId) : null)) {
      return { userId, managerId: normalizedManagerId, changedAt: null, unchanged: true };
    }

    user.managerId = normalizedManagerId;
    await user.save();

    await this.reportingRepository.append({
      userId,
      oldManagerId,
      newManagerId: normalizedManagerId,
      changedBy: actor.actorId ?? null,
    });

    await this.auditService.record({
      action: "REPORTING.MANAGER_ASSIGNED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { oldManagerId, newManagerId: normalizedManagerId },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { userId, managerId: normalizedManagerId, changedAt: new Date() };
  }

  /** ACTIVE direct reports of a user (Manager team scope source). */
  async getDirectReports(userId) {
    await this.userRepository.assertExists(userId);
    const members = await this.userRepository.findDirectReports(userId);
    return members.map((member) => ({
      id: member.id,
      username: member.username,
      name: member.name,
      status: member.status,
      departmentId: member.departmentId ?? null,
      positionId: member.positionId ?? null,
      managerId: member.managerId ?? null,
    }));
  }

  /** Append-only reporting-line change history for a user. */
  async getManagerHistory(userId) {
    await this.userRepository.assertExists(userId);
    const history = await this.reportingRepository.findByUserId(userId);
    return history.map((entry) => ({
      id: String(entry._id),
      userId: String(entry.userId),
      oldManagerId: entry.oldManagerId ? String(entry.oldManagerId) : null,
      newManagerId: entry.newManagerId ? String(entry.newManagerId) : null,
      changedBy: entry.changedBy ? String(entry.changedBy) : null,
      changedAt: entry.changedAt ?? null,
    }));
  }
}

module.exports = { ReportingLineService };
