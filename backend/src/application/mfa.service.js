/**
 * MfaService (FR-051) — TOTP enrollment lifecycle, sign-in challenge and
 * short-lived challenge tokens for elevated-role multi-factor authentication.
 *
 * Coordinates the domain TOTP helpers with persistence and audit. The
 * challenge token is a separate 5-minute JWT (purpose claim "mfa-challenge")
 * distinct from access tokens, signed with the same key material as the
 * access-token provider so verification stays symmetric.
 */

const jwt = require("jsonwebtoken");
const {
  generateSecret,
  verifyCode,
  validateMfaConfig,
} = require("../domain/mfa");
const { buildOtpAuthUri } = require("../infrastructure/mfa-provider");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
  TokenInvalidError,
} = require("../domain/errors");

const MFA_CHALLENGE_PURPOSE = "mfa-challenge";
const MFA_CHALLENGE_TTL_SECONDS = 300;

class MfaService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/mfa.repository').MfaRepository} deps.mfaRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/token-provider').JwtTokenProvider} deps.tokenProvider
   * @param {import('./session.service').SessionService} deps.sessionService
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {object} deps.config security config (jwtSecret, jwtIssuer, jwtAudience)
   */
  constructor({
    mfaRepository,
    userRepository,
    tokenProvider,
    sessionService,
    auditService,
    platformSettingRepository,
    config,
  }) {
    this.mfaRepository = mfaRepository;
    this.userRepository = userRepository;
    this.tokenProvider = tokenProvider;
    this.sessionService = sessionService;
    this.auditService = auditService;
    this.platformSettingRepository = platformSettingRepository;
    this.config = config;
  }

  /**
   * Reads and normalizes the `mfaRequirements` platform setting.
   *
   * @returns {Promise<{ enabled: boolean, requiredForRoles: string[] }>}
   */
  async getConfig() {
    const stored = await this.platformSettingRepository.get("mfaRequirements");
    return validateMfaConfig(stored);
  }

  /**
   * Whether the MFA policy currently applies to a set of role keys.
   *
   * @param {string[]} roles
   * @returns {Promise<boolean>}
   */
  async isRequiredForRoles(roles) {
    const config = await this.getConfig();
    if (!config.enabled) return false;
    const keys = (roles ?? []).map((role) => String(role).toUpperCase());
    return keys.some((role) => config.requiredForRoles.includes(role));
  }

  /** Whether the user has a confirmed, enabled enrollment. */
  async isEnabledForUser(userId) {
    const record = await this.mfaRepository.findByUserId(userId);
    return record?.enabled === true;
  }

  /**
   * Begins enrollment: generates a secret and stages an unconfirmed record.
   * Route layer guards `mfa:manage`. Re-enrolling before confirmation is
   * allowed (rotates the secret); re-enrolling while enabled is a conflict.
   *
   * @param {{ userId: string }} input
   * @returns {Promise<{ secret: string, otpAuthUri: string, qrCodeDataUrl: null }>}
   */
  async enroll({ userId }) {
    const existing = await this.mfaRepository.findByUserId(userId);
    if (existing?.enabled) {
      throw new ConflictError("MFA already enabled.");
    }

    const secret = generateSecret();
    await this.mfaRepository.upsert(userId, {
      secret,
      enabled: false,
      confirmedAt: null,
      disabledAt: null,
    });

    const user = await this.userRepository.findById(userId);
    const account = user?.username ?? userId;
    const otpAuthUri = buildOtpAuthUri({ secret, account });

    return { secret, otpAuthUri, qrCodeDataUrl: null };
  }

  /**
   * Confirms enrollment by validating a live TOTP code from the user's
   * authenticator app. On success the record is enabled and MFA.ENROLLED is
   * audited.
   *
   * @param {{ userId: string, code: string }} input
   */
  async confirmEnrollment({ userId, code }) {
    const record = await this.mfaRepository.findByUserId(userId);
    if (!record) {
      throw new NotFoundError("MFA enrollment not found.", "MFA_NOT_ENROLLED");
    }
    if (record.enabled) {
      throw new ConflictError("MFA already enabled.");
    }
    if (!verifyCode(record.secret, code)) {
      throw new ValidationError("Invalid code.");
    }

    const confirmedAt = new Date();
    await this.mfaRepository.upsert(userId, {
      enabled: true,
      confirmedAt,
      disabledAt: null,
    });

    await this.auditService.record({
      action: "MFA.ENROLLED",
      actor: { userId, roleKeys: [] },
      subject: { type: "USER", id: userId },
      outcome: "SUCCESS",
      metadata: { confirmedAt },
    });

    return { userId, enabled: true, confirmedAt };
  }

  /**
   * Disables a user's MFA (reversible). Audits MFA.DISABLED.
   *
   * @param {{ userId: string, actor?: object }} input
   */
  async disable({ userId, actor = {} }) {
    const record = await this.mfaRepository.findByUserId(userId);
    if (!record) {
      throw new NotFoundError("MFA enrollment not found.", "MFA_NOT_ENROLLED");
    }

    const disabledAt = new Date();
    await this.mfaRepository.upsert(userId, {
      enabled: false,
      disabledAt,
    });

    await this.auditService.record({
      action: "MFA.DISABLED",
      actor: {
        userId: actor.actorId ?? userId,
        roleKeys: actor.actorRoleKeys ?? [],
      },
      subject: { type: "USER", id: userId },
      outcome: "SUCCESS",
      metadata: { disabledAt },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { userId, enabled: false, disabledAt };
  }

  /**
   * Validates a TOTP code against the user's enabled enrollment. Fails closed
   * (returns false) when there is no enabled record. Audits
   * MFA.CHALLENGE_PASSED / MFA.CHALLENGE_FAILED; rate limiting of repeated
   * failures is applied at the route layer.
   *
   * @param {{ userId: string, code: string, device?: object }} input
   * @returns {Promise<boolean>}
   */
  async challenge({ userId, code, device = {} }) {
    const record = await this.mfaRepository.findByUserId(userId);
    const passed = record?.enabled === true && verifyCode(record.secret, code);

    await this.auditService.record({
      action: passed ? "MFA.CHALLENGE_PASSED" : "MFA.CHALLENGE_FAILED",
      actor: { userId, roleKeys: [] },
      subject: { type: "USER", id: userId },
      outcome: passed ? "SUCCESS" : "FAILURE",
      metadata: passed ? {} : { reason: "invalid code" },
      correlationId: device.correlationId,
      ip: device.ip,
      userAgent: device.userAgent,
    });

    return passed;
  }

  /**
   * Issues a short-lived (5 min) JWT authorizing the MFA challenge step of a
   * sign-in. The token is signed with the same key material as access tokens
   * but carries a dedicated `purpose` claim and never a session id, so it can
   * never be mistaken for — or replayed as — an access token.
   *
   * @param {{ userId: string }} input
   * @returns {string} signed challenge token
   */
  issueChallengeToken({ userId }) {
    const security = this.securityConfig();
    if (!security.jwtSecret) {
      throw new Error("MFA challenge signing requires a JWT secret.");
    }
    const ttl = security.mfaChallengeTtlSeconds ?? MFA_CHALLENGE_TTL_SECONDS;
    return jwt.sign(
      { purpose: MFA_CHALLENGE_PURPOSE, ver: 0 },
      security.jwtSecret,
      {
        subject: String(userId),
        issuer: security.jwtIssuer,
        audience: security.jwtAudience,
        expiresIn: ttl,
        algorithm: "HS256",
      }
    );
  }

  /**
   * Verifies a challenge token and returns the challenged user id.
   *
   * @param {string} token
   * @returns {{ userId: string }}
   * @throws {TokenInvalidError} on bad signature, expiry, or wrong purpose
   */
  verifyChallengeToken(token) {
    const security = this.securityConfig();
    if (!security.jwtSecret) {
      throw new TokenInvalidError("MFA challenge token is invalid or expired.");
    }
    let payload;
    try {
      payload = jwt.verify(token, security.jwtSecret, {
        issuer: security.jwtIssuer,
        audience: security.jwtAudience,
        algorithms: ["HS256"],
      });
    } catch {
      throw new TokenInvalidError("MFA challenge token is invalid or expired.");
    }
    if (payload.purpose !== MFA_CHALLENGE_PURPOSE || !payload.sub) {
      throw new TokenInvalidError("MFA challenge token is invalid or expired.");
    }
    return { userId: payload.sub };
  }

  /** Accepts either the full config object or the security block directly. */
  securityConfig() {
    return this.config?.security ?? this.config ?? {};
  }
}

module.exports = { MfaService, MFA_CHALLENGE_PURPOSE, MFA_CHALLENGE_TTL_SECONDS };
