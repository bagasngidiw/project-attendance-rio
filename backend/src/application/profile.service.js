/**
 * ProfileService — employee self-service profile (FR-021).
 *
 * `getMyProfile` returns the caller's own full profile; `updateMyProfile`
 * accepts only registered self-service fields (HR-managed fields rejected),
 * validates values, persists, and records PROFILE.UPDATED (audit + activity).
 * Scope is always the signed-in user — no employee can touch another's.
 */

const {
  isSelfServiceField,
  assertEditableFields,
  validateProfileUpdate,
  maskBankAccount,
} = require("../domain/profile");
const { ConflictError } = require("../domain/errors");

class ProfileService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ userRepository, roleRepository, userRoleRepository, auditService }) {
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.auditService = auditService;
  }

  /** Full profile for the signed-in user. */
  async getMyProfile(userId) {
    const user = await this.userRepository.assertExists(userId);
    return this.toProfileDto(user);
  }

  /**
   * Updates self-service fields only. HR-managed fields are rejected with a
   * ValidationError; email uniqueness is enforced against other users.
   *
   * @param {string} userId
   * @param {object} update
   * @param {object} actor
   */
  async updateMyProfile(userId, update, actor = {}) {
    const user = await this.userRepository.assertExists(userId);

    assertEditableFields(update);
    validateProfileUpdate(update);

    if (update.email && String(update.email).trim()) {
      const existing = await this.userRepository.findByEmail(update.email);
      if (existing && String(existing.id) !== String(userId)) {
        throw new ConflictError(
          "A user with this email already exists.",
          "USER_EXISTS"
        );
      }
    }

    for (const field of Object.keys(update)) {
      if (isSelfServiceField(field)) {
        user[field] = update[field] ?? "";
      }
    }
    await user.save();

    await this.auditService.record({
      action: "PROFILE.UPDATED",
      actor: { userId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { changedFields: Object.keys(update) },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toProfileDto(user);
  }

  /** Maps a user document to the profile DTO (bank account masked). */
  async toProfileDto(user) {
    const roleKeys = await this.loadRoleKeys(user.id);
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      address: user.address ?? "",
      emergencyContact: user.emergencyContact ?? "",
      personalEmail: user.personalEmail ?? "",
      bankAccount: maskBankAccount(user.bankAccount),
      status: user.status,
      roles: roleKeys,
      departmentId: user.departmentId?.toString?.() ?? null,
      positionId: user.positionId?.toString?.() ?? null,
      managerId: user.managerId?.toString?.() ?? null,
      mustChangePassword: user.mustChangePassword,
      notificationPreferences: user.notificationPreferences ?? {},
    };
  }

  async loadRoleKeys(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    const roles = await this.roleRepository.findByIds(roleIds);
    return roles.map((role) => role.key).sort();
  }
}

module.exports = { ProfileService };
