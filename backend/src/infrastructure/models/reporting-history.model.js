/**
 * Mongoose schema + model for the `reporting_history` collection (FR-043).
 * Append-only record of every manager assignment/reassignment for audit and
 * historical review of the reporting line.
 */

const mongoose = require("mongoose");

const reportingHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    oldManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    newManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

reportingHistorySchema.index({ userId: 1, changedAt: 1 });
reportingHistorySchema.index({ changedBy: 1 });

const ReportingHistoryModel = mongoose.model(
  "ReportingHistory",
  reportingHistorySchema
);

module.exports = { ReportingHistoryModel };
