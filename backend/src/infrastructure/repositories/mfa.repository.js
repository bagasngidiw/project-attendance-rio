/**
 * MfaRepository — persistence for TOTP enrollment records (FR-051).
 * One record per user; upsert semantics so re-enrollment replaces the secret.
 */

const { MfaModel } = require("../models/mfa.model");

class MfaRepository {
  /**
   * @param {string} userId
   * @returns {Promise<object|null>} lean MFA document or null
   */
  async findByUserId(userId) {
    return MfaModel.findOne({ userId }).lean();
  }

  /**
   * Creates or replaces the enrollment for a user with only the provided
   * fields (partial updates keep unrelated lifecycle flags intact).
   *
   * @param {string} userId
   * @param {{ secret?: string, enabled?: boolean, confirmedAt?: Date|null, disabledAt?: Date|null }} fields
   */
  async upsert(userId, { secret, enabled, confirmedAt, disabledAt } = {}) {
    const update = { userId };
    if (secret !== undefined) update.secret = secret;
    if (enabled !== undefined) update.enabled = enabled;
    if (confirmedAt !== undefined) update.confirmedAt = confirmedAt;
    if (disabledAt !== undefined) update.disabledAt = disabledAt;
    return MfaModel.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true, new: true, runValidators: true }
    ).lean();
  }

  /**
   * Deletes the enrollment record for a user.
   *
   * @param {string} userId
   * @returns {Promise<number>} number of deleted documents
   */
  async deleteByUserId(userId) {
    const result = await MfaModel.deleteOne({ userId });
    return result.deletedCount ?? 0;
  }
}

module.exports = { MfaRepository };
