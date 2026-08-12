/**
 * Mongoose schema + model for the `sessions` collection (design §7.6).
 */

const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    refreshTokenHash: { type: String, required: true },
    device: {
      userAgent: { type: String, default: "" },
      ip: { type: String, default: "" },
    },
    lastActivityAt: { type: Date, default: Date.now },
    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// TTL index: MongoDB auto-removes expired sessions for cleanup.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SessionModel = mongoose.model("Session", sessionSchema);

module.exports = { SessionModel };
