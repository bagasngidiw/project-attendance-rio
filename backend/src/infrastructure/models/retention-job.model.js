/**
 * Mongoose schema + model for the `retention_jobs` collection (FR-040).
 * Records each data-retention sweep run with its outcome and the triggering
 * actor.
 */

const mongoose = require("mongoose");

const RETENTION_JOB_STATUS = Object.freeze(["RUNNING", "COMPLETED", "FAILED"]);

const retentionJobSchema = new mongoose.Schema(
  {
    jobType: { type: String, enum: ["SWEEP"], required: true, index: true },
    status: {
      type: String,
      enum: RETENTION_JOB_STATUS,
      required: true,
      index: true,
    },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

retentionJobSchema.index({ jobType: 1, startedAt: -1 });

const RetentionJobModel = mongoose.model("RetentionJob", retentionJobSchema);

module.exports = { RetentionJobModel, RETENTION_JOB_STATUS };
