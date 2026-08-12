/**
 * Mongoose schema + model for the `refresh_tokens` collection (design §7.7).
 * Only SHA-256 hashes are stored; the raw opaque token is never persisted.
 * Supports rotation and reuse detection via `familyId`.
 */

const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: { type: String, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  {
    versionKey: false,
  }
);

// TTL index: expired refresh tokens are auto-removed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshTokenModel = mongoose.model(
  "RefreshToken",
  refreshTokenSchema
);

module.exports = { RefreshTokenModel };
