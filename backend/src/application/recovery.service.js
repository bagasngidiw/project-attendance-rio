/**
 * RecoveryService — self-service password recovery orchestration (FR-045).
 *
 * requestRecovery is deliberately non-revealing: the response is `{ ok: true }`
 * whether or not the identifier matches an account, so the endpoint cannot be
 * used to enumerate users. When a match exists, a one-time token is created
 * and recorded as a SHA-256 digest. EMAIL SEAM: the plaintext token is the
 * value that a production mailer would send to the account holder — it is
 * intentionally never returned by the API.
 *
 * resetPassword rotates the credential, invalidates all existing sessions
 * (tokenVersion bump + optional session revocation), consumes the token, and
 * audits AUTH.PASSWORD_RECOVERED.
 */

const {
  RECOVERY_PURPOSE,
  generateRecoveryToken,
  hashToken,
  validateRecoveryRequest,
} = require("../domain/recovery");
const { validatePassword } = require("../domain/password-policy");
const {
  ValidationError,
  NotFoundError,
  PasswordPolicyError,
} = require("../domain/errors");

const RECOVERY_SETTINGS_KEY = "recoverySettings";

/** Defaults used when no platform setting has been stored. */
const DEFAULT_RECOVERY_SETTINGS = Object.freeze({
  cooldownMs: 60 * 1000,
  tokenTtlMs: 15 * 60 * 1000,
});

class RecoveryService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/recovery-token.repository').RecoveryTokenRepository} deps.recoveryTokenRepository
   * @param {import('../infrastructure/password-hasher').BcryptPasswordHasher} deps.passwordHasher
   * @param {import('./password.service').PasswordService} deps.passwordService
   * @param {import('./session.service').SessionService} [deps.sessionService] optional — revokes sessions on reset
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   */
  constructor({
    userRepository,
    recoveryTokenRepository,
    passwordHasher,
    passwordService,
    sessionService = null,
    auditService,
    platformSettingRepository,
  }) {
    this.userRepository = userRepository;
    this.recoveryTokenRepository = recoveryTokenRepository;
    this.passwordHasher = passwordHasher;
    this.passwordService = passwordService;
    this.sessionService = sessionService;
    this.auditService = auditService;
    this.platformSettingRepository = platformSettingRepository;
  }

  /** Effective recovery settings: stored platform setting wins over defaults. */
  async getRecoverySettings() {
    const stored = await this.platformSettingRepository.get(RECOVERY_SETTINGS_KEY);
    return {
      ...DEFAULT_RECOVERY_SETTINGS,
      ...(stored && typeof stored === "object" ? stored : {}),
    };
  }

  /**
   * Public recovery request. Always resolves `{ ok: true }`. When the
   * identifier matches an ACTIVE-independent account the cooldown is enforced
   * and, when allowed, a fresh token is minted. A matched account within the
   * cooldown window receives no new token (rate limiting without revealing
   * which case applied).
   *
   * @param {{ identifier: string, ip?: string, userAgent?: string, correlationId?: string }} input
   * @returns {Promise<{ ok: boolean }>}
   */
  async requestRecovery({ identifier, ip = "", userAgent = "", correlationId = "" }) {
    const { identifier: normalized } = validateRecoveryRequest({ identifier });
    const settings = await this.getRecoverySettings();

    const byUsername = await this.userRepository.findByUsername(normalized);
    const byEmail = await this.userRepository.findByEmail(normalized);
    const user = byUsername ?? byEmail;

    if (user) {
      // A non-positive cooldown disables rate limiting entirely (no window),
      // so a token is issued on every request. This also removes the
      // same-millisecond race where `cooldownMs = 0` could suppress a token.
      const cooldownMs = Number.isFinite(settings.cooldownMs) ? settings.cooldownMs : 0;
      let recent = 0;
      if (cooldownMs > 0) {
        const since = new Date(Date.now() - cooldownMs);
        recent = await this.recoveryTokenRepository.countRecentForUser(
          user.id,
          since
        );
      }

      if (recent === 0) {
        const token = generateRecoveryToken();
        await this.recoveryTokenRepository.create({
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: RECOVERY_PURPOSE,
          expiresAt: new Date(Date.now() + settings.tokenTtlMs),
        });
      }

      await this.auditService.record({
        action: "AUTH.RECOVERY_REQUESTED",
        actor: { userId: user.id, roleKeys: [] },
        subject: { type: "USER", id: user.id, summary: user.username },
        outcome: "SUCCESS",
        metadata: { rateLimited: recent > 0 },
        correlationId,
        ip,
        userAgent,
      });
    } else {
      await this.auditService.record({
        action: "AUTH.RECOVERY_REQUESTED",
        actor: null,
        subject: { type: "USER", summary: normalized },
        outcome: "SUCCESS",
        correlationId,
        ip,
        userAgent,
      });
    }

    return { ok: true };
  }

  /**
   * Consumes a recovery token and rotates the account credential. The new
   * password must satisfy the platform policy; the `mustChangePassword` gate
   * is cleared and every existing session is invalidated via the tokenVersion
   * bump (and revoked when a session service is wired).
   *
   * @param {{ token: string, newPassword: string, ip?: string, userAgent?: string, correlationId?: string }} input
   * @returns {Promise<{ ok: boolean }>}
   */
  async resetPassword({ token, newPassword, ip = "", userAgent = "", correlationId = "" }) {
    if (!token || typeof token !== "string" || token.length > 512) {
      throw new ValidationError("A valid recovery token is required.", {
        field: "token",
      });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 1) {
      throw new ValidationError("A new password is required.", {
        field: "newPassword",
      });
    }

    const tokenDoc = await this.recoveryTokenRepository.findValidByHash(
      hashToken(token),
      RECOVERY_PURPOSE
    );
    if (!tokenDoc) {
      throw new ValidationError(
        "The recovery token is invalid or has expired. Request a new one.",
        { field: "token" }
      );
    }

    const user = await this.userRepository.findById(tokenDoc.userId);
    if (!user) {
      throw new NotFoundError(
        "The account associated with this recovery token no longer exists.",
        "USER_NOT_FOUND"
      );
    }
    if (user.status !== "ACTIVE") {
      throw new ValidationError(
        "This account is not active and cannot recover its password.",
        { field: "token" }
      );
    }

    const policy = await this.passwordService.getPasswordPolicy();
    const { valid, violations } = validatePassword(policy, newPassword);
    if (!valid) {
      throw new PasswordPolicyError(violations);
    }

    const newHash = await this.passwordHasher.hash(newPassword);
    await this.userRepository.updatePassword(user, newHash, {
      mustChangePassword: false,
    });
    await this.userRepository.bumpTokenVersion(user);

    if (this.sessionService) {
      await this.sessionService.revokeAllForUser(user.id);
    }

    await this.recoveryTokenRepository.markUsed(tokenDoc.id ?? tokenDoc._id);

    await this.auditService.record({
      action: "AUTH.PASSWORD_RECOVERED",
      actor: { userId: user.id, roleKeys: [] },
      subject: { type: "USER", id: user.id, summary: user.username },
      outcome: "SUCCESS",
      metadata: { passwordVersion: user.passwordVersion },
      correlationId,
      ip,
      userAgent,
    });

    return { ok: true };
  }
}

module.exports = { RecoveryService, DEFAULT_RECOVERY_SETTINGS };
