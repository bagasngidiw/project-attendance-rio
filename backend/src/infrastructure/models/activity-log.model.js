/**
 * Mongoose schema + model for the `activity_logs` collection (design §7.2).
 *
 * Operational surface (FR-013): records what users did, with no security
 * secrets. Shares the correlation pipeline with audit events so a request can
 * be traced across both surfaces.
 */

const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    category: { type: String, enum: ["ACTIVITY"], default: "ACTIVITY" },
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    subject: {
      type: { type: String, default: "" },
      id: { type: String, default: "" },
      summary: { type: String, default: "" },
    },
    correlationId: { type: String, default: "", index: true },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

activityLogSchema.index({ "actor.userId": 1, recordedAt: -1 });
activityLogSchema.index({ action: 1, recordedAt: -1 });

const ActivityLogModel = mongoose.model("ActivityLog", activityLogSchema);

module.exports = { ActivityLogModel };
