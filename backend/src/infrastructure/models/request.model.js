/**
 * Mongoose schema + model for the `requests` collection (design §7.1).
 *
 * One polymorphic collection discriminated by `type` (LEAVE | OVERTIME | TRIP)
 * with a Mixed `payload` so per-type fields live on the same lifecycle. The
 * `version` counter is the optimistic-lock guard for status transitions.
 */

const mongoose = require("mongoose");

const REQUEST_TYPES = Object.freeze(["LEAVE", "OVERTIME", "TRIP", "PERMISSION", "SAKIT"]);
const REQUEST_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

const requestSchema = new mongoose.Schema(
  {
    type: { type: String, enum: REQUEST_TYPES, required: true, index: true },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: "DRAFT",
      index: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    approverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    cancellationReason: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    // Approval workflow (FR-007/FR-042): the ordered routing chain, the
    // current step index (multi-level), and the embedded last decision.
    approvalChain: {
      type: [
        {
          step: Number,
          approverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          status: { type: String, default: "PENDING" },
        },
      ],
      default: [],
    },
    approvalStep: { type: Number, default: 0 },
    decision: {
      action: { type: String, enum: ["APPROVED", "REJECTED"], default: null },
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      comment: { type: String, default: "" },
      decidedAt: { type: Date, default: null },
    },
    // FR-002: unified approval structure (agents.md §9/§14) — the requester's
    // chosen target, the claimed/assigned approver, the terminal decision and
    // the immutable configuration snapshot captured at submission time.
    approval: {
      targetType: { type: String, enum: ["ROLE", "USER"], default: null },
      targetRoleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", default: null },
      targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      assignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      assignedAt: { type: Date, default: null },
      status: { type: String, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      approvedAt: { type: Date, default: null },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null },
      configurationSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

requestSchema.index({ requesterId: 1, status: 1 });
requestSchema.index({ type: 1, status: 1 });
requestSchema.index({ approverId: 1, status: 1 });
requestSchema.index({ submittedAt: 1 });
// FR-001: approved-leave coverage queries
// ({ requesterId, type: LEAVE, status: APPROVED, payload date-range overlap}).
// Nested `payload.*` keys are indexed as dotted paths on the Mixed payload.
requestSchema.index({
  requesterId: 1,
  type: 1,
  status: 1,
  "payload.startDate": 1,
  "payload.endDate": 1,
});

const RequestModel = mongoose.model("Request", requestSchema);

module.exports = { RequestModel, REQUEST_TYPES, REQUEST_STATUSES };
