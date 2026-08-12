/**
 * RecoveryTokenRepository — persistence for one-time recovery tokens
 * (FR-045). Tokens are stored as SHA-256 digests; lookups filter to unexpired,
 * unused rows for the requested purpose.
 */

const { RecoveryTokenModel } = require("../models/recovery-token.model");
const { RECOVERY_PURPOSE } = require("../../domain/recovery");

class RecoveryTokenRepository {
  /**
   * @param {{ userId: string, tokenHash: string, purpose?: string, expiresAt: Date }} input
   */
  async create({ userId, tokenHash, purpose = RECOVERY_PURPOSE, expiresAt }) {
    return RecoveryTokenModel.create({
      userId,
      tokenHash,
      purpose,
      expiresAt,
      usedAt: null,
    });
  }

  /** Returns a token that is unused, unexpired, and of the given purpose. */
  async findValidByHash(tokenHash, purpose = RECOVERY_PURPOSE) {
    return RecoveryTokenModel.findOne({
      tokenHash,
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
  }

  /** Marks a token consumed so it can never be replayed. */
  async markUsed(id) {
    await RecoveryTokenModel.updateOne(
      { _id: id },
      { $set: { usedAt: new Date() } }
    );
  }

  /** Sweeps expired tokens. Returns the number deleted. */
  async deleteExpired(now = new Date()) {
    const result = await RecoveryTokenModel.deleteMany({
      expiresAt: { $lt: now },
    });
    return result.deletedCount ?? 0;
  }

  /** Counts tokens issued for a user since `since` (cooldown rate limiting). */
  async countRecentForUser(userId, since) {
    return RecoveryTokenModel.countDocuments({
      userId,
      createdAt: { $gte: since },
    });
  }
}

module.exports = { RecoveryTokenRepository };
