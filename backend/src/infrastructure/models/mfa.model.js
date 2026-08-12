/**
 * Mongoose schema + model for the `mfas` collection (FR-051).
 *
 * One record per user holding the TOTP secret and lifecycle flags. v1 stores
 * the secret at rest unencrypted (documented risk); it is never logged or
 * returned by the API after enrollment, and the audit scrubber strips any
 * metadata key ending in "secret" before persistence.
 */

const mongoose = require("mongoose");

const mfaSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    secret: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const MfaModel = mongoose.model("Mfa", mfaSchema);

module.exports = { MfaModel };
