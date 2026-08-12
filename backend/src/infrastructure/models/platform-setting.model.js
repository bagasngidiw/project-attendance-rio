/**
 * Mongoose schema + model for the `platform_settings` collection.
 *
 * A generic key-value store for platform configuration that must survive
 * restarts and be auditable (FR-044 password policy, future FR-032 settings).
 * Each write records who changed it and when.
 */

const mongoose = require("mongoose");

const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

const PlatformSettingModel = mongoose.model("PlatformSetting", platformSettingSchema);

module.exports = { PlatformSettingModel };
