/**
 * RefreshTokenRepository — persistence access for rotated refresh tokens,
 * including reuse detection (design §4.3).
 */

const { RefreshTokenModel } = require("../models/refresh-token.model");

class RefreshTokenRepository {
  async create({ tokenHash, userId, sessionId, familyId, expiresAt }) {
    return RefreshTokenModel.create({
      tokenHash,
      userId,
      sessionId,
      familyId,
      expiresAt,
    });
  }

  async findByHash(tokenHash) {
    return RefreshTokenModel.findOne({ tokenHash });
  }

  /**
   * Marks a token as used. Returns false if it was already used or revoked,
   * which signals token reuse to the caller.
   *
   * @param {object} tokenDoc
   * @returns {Promise<boolean>} true if this was the first (valid) use
   */
  async markUsed(tokenDoc) {
    if (tokenDoc.usedAt || tokenDoc.revokedAt) return false;
    tokenDoc.usedAt = new Date();
    await tokenDoc.save();
    return true;
  }

  /**
   * Revokes an entire rotation family after reuse detection forces re-auth.
   *
   * @param {string} familyId
   */
  async revokeFamily(familyId) {
    await RefreshTokenModel.updateMany(
      { familyId },
      { $set: { revokedAt: new Date() } }
    );
  }

  /**
   * Revokes all refresh tokens belonging to a session (sign-out).
   *
   * @param {string} sessionId
   */
  async revokeBySession(sessionId) {
    await RefreshTokenModel.updateMany(
      { sessionId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  /**
   * Revokes all refresh tokens belonging to multiple sessions (sign-out-all).
   *
   * @param {string[]} sessionIds
   */
  async revokeBySessions(sessionIds) {
    if (sessionIds.length === 0) return;
    await RefreshTokenModel.updateMany(
      { sessionId: { $in: sessionIds }, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }
}

module.exports = { RefreshTokenRepository };
