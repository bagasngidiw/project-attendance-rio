/**
 * PasswordService — password policy + credential-change orchestration
 * (FR-044 / FR-028).
 *
 * Owns the platform-wide password policy (config defaults overridden by the
 * stored platform setting), enforces it at every credential change point, and
 * handles the self-service change-password flow. No password value is ever
 * logged or returned; audit records carry only metadata.
 */

const {
  validatePolicy,
  validatePassword,
  isPasswordReused,
  isExpired,
} = require("../domain/password-policy");
const {
  CurrentPasswordInvalidError,
  PasswordPolicyError,
} = require("../domain/errors");

const PASSWORD_POLICY_KEY = "password_policy";

class PasswordService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/password-hasher').BcryptPasswordHasher} deps.passwordHasher
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {object} deps.config security config (passwordPolicy defaults)
   */
  constructor({ userRepository, passwordHasher, platformSettingRepository, auditService, config }) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
    this.config = config;
  }

  /**
   * Resolves the effective platform password policy: stored setting wins over
   * config defaults; both are structurally validated.
   *
   * @returns {Promise<object>} normalized policy
   */
  async getPasswordPolicy() {
    const stored = await this.platformSettingRepository.get(PASSWORD_POLICY_KEY);
    return validatePolicy({
      ...(this.config.security.passwordPolicy ?? {}),
      ...(stored ?? {}),
    });
  }

  /**
   * Updates the platform password policy (FR-044). Validates, persists, and
   * records a SETTINGS.CHANGED audit event.
   *
   * @param {object} policy raw policy input
   * @param {object} actor
   */
  async updatePasswordPolicy(policy, actor = {}) {
    const normalized = validatePolicy(policy);
    await this.platformSettingRepository.set(
      PASSWORD_POLICY_KEY,
      normalized,
      actor.actorId ?? null
    );

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: PASSWORD_POLICY_KEY, summary: "password-policy" },
      outcome: "SUCCESS",
      metadata: { setting: PASSWORD_POLICY_KEY, policy: normalized },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return normalized;
  }

  /**
   * Validates a password against the current policy (used by provisioning and
   * admin reset). Throws PasswordPolicyError on any violation.
   *
   * @param {string} password
   * @returns {Promise<void>}
   */
  async assertPasswordCompliant(password) {
    const policy = await this.getPasswordPolicy();
    const { valid, violations } = validatePassword(policy, password);
    if (!valid) {
      throw new PasswordPolicyError(violations);
    }
  }

  /**
   * True when the user's password has expired under the current policy.
   *
   * @param {object} user
   * @returns {Promise<boolean>}
   */
  async isPasswordExpired(user) {
    const policy = await this.getPasswordPolicy();
    return isExpired(policy, user.passwordChangedAt);
  }

  /**
   * Self-service password change (FR-028 §5.4):
   *  1. verify the current password
   *  2. enforce the policy (length + complexity)
   *  3. block reuse of recent history hashes
   *  4. rotate the hash, stamp `passwordChangedAt`, clear the
   *     `mustChangePassword` gate, and bump `tokenVersion` (kills stale access
   *     tokens; the client's 401-refresh restores a fresh session)
   *  5. record AUTH.PASSWORD_CHANGED (audit + activity)
   *
   * @param {string} userId
   * @param {{ currentPassword: string, newPassword: string }} input
   * @param {object} actor
   * @returns {Promise<{ success: true }>}
   */
  async changePassword(userId, { currentPassword, newPassword }, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    const policy = await this.getPasswordPolicy();

    const currentOk = await this.passwordHasher.verify(
      currentPassword,
      user.passwordHash
    );
    if (!currentOk) {
      throw new CurrentPasswordInvalidError();
    }

    const { valid, violations } = validatePassword(policy, newPassword);
    if (!valid) {
      throw new PasswordPolicyError(violations);
    }

    const reused = await isPasswordReused(
      newPassword,
      user.passwordHistory,
      this.passwordHasher
    );
    if (reused) {
      throw new PasswordPolicyError([
        "This password was used recently and cannot be reused.",
      ]);
    }

    const newHash = await this.passwordHasher.hash(newPassword);
    await this.userRepository.updatePassword(user, newHash, {
      mustChangePassword: false,
      historyLimit: policy.historyLength,
    });
    await this.userRepository.bumpTokenVersion(user);

    await this.auditService.record({
      action: "AUTH.PASSWORD_CHANGED",
      actor: { userId: user.id, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: user.id, summary: user.username },
      outcome: "SUCCESS",
      metadata: { passwordVersion: user.passwordVersion },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { success: true };
  }
}

module.exports = { PasswordService, PASSWORD_POLICY_KEY };
