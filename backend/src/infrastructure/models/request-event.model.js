/**
 * Mongoose schema + model for the `request_events` collection (design §7.2).
 *
 * Append-only history of lifecycle transitions (FR-008 base): every
 * submit/approve/reject/cancel is recorded once with actor, comment, and
 * from/to status. No update or delete paths exist in the application.
 */

const mongoose = require("mongoose");

const REQUEST_EVENTS = Object.freeze([
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EDITED",
  // FR-063: escalation is an event, not a status.
  "ESCALATED",
  // FR-002/FR-009: approval workflow revamp events.
  "ASSIGNED",
  "CLAIMED",
]);

const requestEventSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      required: true,
      index: true,
    },
    event: { type: String, enum: REQUEST_EVENTS, required: true },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // FR-009: immutable actor/role name snapshots so the history stays readable
    // even after the user renames or the role changes.
    actorNameSnapshot: { type: String, default: null },
    actorRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
    },
    actorRoleNameSnapshot: { type: String, default: null },
    comment: { type: String, default: "" },
    fromStatus: { type: String, default: "" },
    toStatus: { type: String, required: true },
    recordedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

requestEventSchema.index({ requestId: 1, recordedAt: 1 });
requestEventSchema.index({ actorId: 1 });

const RequestEventModel = mongoose.model("RequestEvent", requestEventSchema);

module.exports = { RequestEventModel, REQUEST_EVENTS };
