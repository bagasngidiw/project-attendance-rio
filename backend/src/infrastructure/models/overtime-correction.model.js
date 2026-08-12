/**
 * Mongoose schema + model for the `overtime_corrections` collection
 * (FR-055). Append-only record of every HR overtime correction: the prior
 * value, the corrected value, the actor, and the reason. Corrections are an
 * audit trail and never mutate the original overtime request — no update or
 * delete paths exist in the application.
 */

const mongoose = require("mongoose");

const overtimeCorrectionSchema = new mongoose.Schema(
  {
    overtimeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      required: true,
      index: true,
    },
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, required: true },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

overtimeCorrectionSchema.index({ overtimeId: 1, createdAt: 1 });
overtimeCorrectionSchema.index({ correctedBy: 1 });

const OvertimeCorrectionModel = mongoose.model(
  "OvertimeCorrection",
  overtimeCorrectionSchema
);

module.exports = { OvertimeCorrectionModel };
