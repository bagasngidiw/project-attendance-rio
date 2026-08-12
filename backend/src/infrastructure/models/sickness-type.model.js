/**
 * Mongoose schema + model for the `sickness_types` collection (TODO.md §5).
 * Independent from leave types; PENDING = user-suggested (admin activates).
 */

const mongoose = require("mongoose");

const SICKNESS_TYPE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE", "PENDING"]);

const sicknessTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: SICKNESS_TYPE_STATUSES,
      default: "ACTIVE",
      index: true,
    },
    isSystem: { type: Boolean, default: false },
    // Who suggested it (for PENDING types) — admin activation clears this.
    suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const SicknessTypeModel = mongoose.model("SicknessType", sicknessTypeSchema);

module.exports = { SicknessTypeModel, SICKNESS_TYPE_STATUSES };
