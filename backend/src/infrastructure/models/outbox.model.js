/**
 * Mongoose schema + model for the `outbox` collection (design §7.3).
 *
 * Reliability seam for the capture pipeline: domain events are written here
 * transactionally before being dispatched to audit_events / activity_logs.
 * A dispatcher drains PENDING entries; failures stay for retry so logging
 * never blocks core operations.
 */

const mongoose = require("mongoose");

const OUTBOX_STATUS = Object.freeze({
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
});

const outboxSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(OUTBOX_STATUS),
      default: OUTBOX_STATUS.PENDING,
      index: true,
    },
    attemptCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

const OutboxModel = mongoose.model("Outbox", outboxSchema);

module.exports = { OutboxModel, OUTBOX_STATUS };
