/**
 * Mongoose schema + model for the `positions` collection (FR-024).
 * Flat position list; deactivation preserves historical references.
 */

const mongoose = require("mongoose");

const ORG_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const positionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ORG_STATUSES, default: "ACTIVE", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PositionModel = mongoose.model("Position", positionSchema);

module.exports = { PositionModel, ORG_STATUSES };
