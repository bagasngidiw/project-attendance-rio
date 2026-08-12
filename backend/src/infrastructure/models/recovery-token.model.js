/**
 * Mongoose schema + model for the `recoverytokens` collection (FR-045).
 *
 * Only the SHA-256 digest of a recovery token is stored; the plaintext token
 * lives solely in the email sent to the account holder.
 */

const mongoose = require("mongoose");

const recoveryTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    purpose: { type: String, default: "PASSWORD_RESET", required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

const RecoveryTokenModel = mongoose.model(
  "RecoveryToken",
  recoveryTokenSchema
);

module.exports = { RecoveryTokenModel };
