/**
 * SessionRepository — persistence access for the Session aggregate.
 */

const { SessionModel } = require("../models/session.model");

class SessionRepository {
  async create({ sessionId, userId, refreshTokenHash, device, expiresAt }) {
    return SessionModel.create({
      sessionId,
      userId,
      refreshTokenHash,
      device,
      issuedAt: new Date(),
      expiresAt,
    });
  }

  async findById(sessionId) {
    return SessionModel.findOne({ sessionId });
  }

  async findByUserId(userId) {
    return SessionModel.find({ userId, revokedAt: null });
  }

  async touchActivity(sessionId) {
    await SessionModel.updateOne(
      { sessionId },
      { $set: { lastActivityAt: new Date() } }
    );
  }

  async revoke(sessionId) {
    await SessionModel.updateOne(
      { sessionId },
      { $set: { revokedAt: new Date() } }
    );
  }

  async revokeAllForUser(userId) {
    const result = await SessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return result.modifiedCount ?? 0;
  }

  async isExpired(session) {
    return (
      session.revokedAt !== null ||
      session.expiresAt === undefined ||
      session.expiresAt <= new Date()
    );
  }
}

module.exports = { SessionRepository };
