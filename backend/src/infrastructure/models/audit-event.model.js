/**
 * Mongoose schema + model for the `audit_events` collection (design §7.1).
 *
 * Append-only and tamper-resistant: each entry stores `prevHash` + `hash`
 * forming an SHA-256 chain over canonical fields. No update or delete
 * operations exist anywhere in the application for this collection.
 */

const mongoose = require("mongoose");

const OUTCOME = Object.freeze(["SUCCESS", "FAILURE", "DENIED"]);

const auditEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    category: { type: String, enum: ["AUDIT"], default: "AUDIT" },
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      roleKeys: { type: [String], default: [] },
      scope: { type: String, default: "" },
    },
    subject: {
      type: { type: String, default: "" },
      id: { type: String, default: "" },
      summary: { type: String, default: "" },
    },
    outcome: { type: String, enum: OUTCOME, default: "SUCCESS" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    correlationId: { type: String, default: "", index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    prevHash: { type: String, default: "" },
    hash: { type: String, required: true },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

auditEventSchema.index({ action: 1, recordedAt: -1 });
auditEventSchema.index({ "actor.userId": 1, recordedAt: -1 });
auditEventSchema.index({ "subject.type": 1, recordedAt: -1 });
auditEventSchema.index({ outcome: 1, recordedAt: -1 });

const AuditEventModel = mongoose.model("AuditEvent", auditEventSchema);

module.exports = { AuditEventModel, OUTCOME };
