/**
 * Mongoose schema + model for the `delegations` collection (FR-009).
 * An approver grants another user approval power for a date window and
 * (optionally) a subset of request types.
 */

const mongoose = require("mongoose");

const delegationSchema = new mongoose.Schema(
  {
    delegatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    delegateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requestTypes: { type: [String], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED"],
      default: "ACTIVE",
      index: true,
    },
    revokedAt: { type: Date, default: null },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  }
);

const DelegationModel = mongoose.model("Delegation", delegationSchema);

module.exports = { DelegationModel };
