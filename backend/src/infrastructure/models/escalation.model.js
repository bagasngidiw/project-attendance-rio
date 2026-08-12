/**
 * Mongoose schema + model for the `escalations` collection (FR-063).
 *
 * An escalation record captures a requester/approver escalating a PENDING
 * request to a higher-level role. Escalation is notification-only: it never
 * changes the request status and never creates an approval step.
 */

const mongoose = require("mongoose");

const escalationSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true, index: true },
    escalatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetRoleLevel: { type: Number, default: null },
    message: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

escalationSchema.index({ requestId: 1, createdAt: -1 });

const EscalationModel = mongoose.model("Escalation", escalationSchema);

module.exports = { EscalationModel };
