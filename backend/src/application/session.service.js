/**
 * SessionService — session lifecycle: create, validate, rotate, revoke.
 *
 * Owns the mapping between a raw refresh token, its DB record, and the
 * session it belongs to. Enforces refresh-token rotation and reuse detection
 * per design §4.3.
 */

const crypto = require("crypto");
const {
  generateOpaqueToken,
  hashOpaqueToken,
} = require("../infrastructure/token-provider");
const {
  RefreshTokenReuseError,
  TokenInvalidError,
} = require("../domain/errors");

class SessionService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/session.repository').SessionRepository} deps.sessionRepository
   * @param {import('../infrastructure/repositories/refresh-token.repository').RefreshTokenRepository} deps.refreshTokenRepository
   * @param {object} deps.config session TTL config
   */
  constructor({ sessionRepository, refreshTokenRepository, config }) {
    this.sessionRepository = sessionRepository;
    this.refreshTokenRepository = refreshTokenRepository;
    this.config = config;
  }

  newSessionId() {
    return `sess_${crypto.randomBytes(12).toString("hex")}`;
  }

  newFamilyId() {
    return `fam_${crypto.randomBytes(16).toString("hex")}`;
  }

  /**
   * Creates a session and its first refresh token for a signed-in user.
   *
   * @param {{ userId: string, device?: { userAgent: string, ip: string } }} input
   * @returns {Promise<{ sessionId: string, refreshToken: string, expiresAt: Date }>}
   */
  async openSession({ userId, device = { userAgent: "", ip: "" } }) {
    const sessionId = this.newSessionId();
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlSeconds * 1000
    );

    await this.sessionRepository.create({
      sessionId,
      userId,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      device,
      expiresAt,
    });

    await this.refreshTokenRepository.create({
      tokenHash: hashOpaqueToken(refreshToken),
      userId,
      sessionId,
      familyId: this.newFamilyId(),
      expiresAt,
    });

    return { sessionId, refreshToken, expiresAt };
  }

  /**
   * Validates an opaque refresh token and returns its record.
   * Rejects expired/revoked tokens; throws a typed error on reuse so the
   * caller can force re-authentication.
   *
   * @param {string} refreshToken raw opaque token
   * @returns {Promise<object>} refresh token document
   */
  async validateRefreshToken(refreshToken) {
    if (!refreshToken) {
      throw new TokenInvalidError();
    }
    const tokenDoc = await this.refreshTokenRepository.findByHash(
      hashOpaqueToken(refreshToken)
    );
    if (!tokenDoc || tokenDoc.revokedAt) {
      throw new TokenInvalidError();
    }
    if (tokenDoc.expiresAt <= new Date()) {
      throw new TokenInvalidError();
    }
    return tokenDoc;
  }

  /**
   * Rotates a refresh token: marks the presented one used and issues a new
   * token in the same family. Detects reuse (already-used token) and revokes
   * the whole family before forcing re-authentication.
   *
   * @param {string} presentedToken raw opaque token
   * @returns {Promise<{ newRefreshToken: string, tokenDoc: object }>}
   */
  async rotateRefreshToken(presentedToken) {
    const tokenDoc = await this.validateRefreshToken(presentedToken);

    const isFirstUse = await this.refreshTokenRepository.markUsed(tokenDoc);
    if (!isFirstUse) {
      // Reuse of a rotated token: an attacker may have stolen it.
      await this.refreshTokenRepository.revokeFamily(tokenDoc.familyId);
      throw new RefreshTokenReuseError();
    }

    const newRefreshToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlSeconds * 1000
    );

    await this.refreshTokenRepository.create({
      tokenHash: hashOpaqueToken(newRefreshToken),
      userId: tokenDoc.userId,
      sessionId: tokenDoc.sessionId,
      familyId: tokenDoc.familyId,
      expiresAt,
    });

    await this.sessionRepository.touchActivity(tokenDoc.sessionId);

    return { newRefreshToken, tokenDoc };
  }

  async findById(sessionId) {
    return this.sessionRepository.findById(sessionId);
  }

  async findSessionById(sessionId) {
    return this.sessionRepository.findById(sessionId);
  }

  async touchActivity(sessionId) {
    await this.sessionRepository.touchActivity(sessionId);
  }

  /**
   * Validates a session record: not revoked, not expired, and within the
   * inactivity window.
   *
   * @param {object} session session document
   * @returns {Promise<void>}
   */
  async assertSessionUsable(session) {
    if (!session || session.revokedAt) {
      throw new TokenInvalidError("Session has been revoked.");
    }
    if (session.expiresAt <= new Date()) {
      throw new TokenInvalidError("Session has expired.");
    }
    const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
    if (idleMs > this.config.sessionInactivityMs) {
      throw new TokenInvalidError("Session idle timeout exceeded.");
    }
    await this.sessionRepository.touchActivity(session.sessionId);
  }

  /**
   * Revokes a session (and its refresh tokens) on sign-out.
   *
   * @param {string} sessionId
   */
  async revokeSession(sessionId) {
    await this.sessionRepository.revoke(sessionId);
    await this.refreshTokenRepository.revokeBySession(sessionId);
  }

  /**
   * Revokes every session for a user (sign-out-all).
   *
   * @param {string} userId
   * @returns {Promise<number>} number of sessions revoked
   */
  async revokeAllForUser(userId) {
    const sessions = await this.sessionRepository.findByUserId(userId);
    const sessionIds = sessions.map((s) => s.sessionId);
    if (sessionIds.length > 0) {
      await this.refreshTokenRepository.revokeBySessions(sessionIds);
    }
    return this.sessionRepository.revokeAllForUser(userId);
  }
}

module.exports = { SessionService };
