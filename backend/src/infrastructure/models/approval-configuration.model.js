/**
 * Mongoose schema + model for the `approval_configurations` collection (FR-001).
 *
 * One document per request type; the embedded `roles[]` array holds the
 * configured role entries (roleId ref + level + flags). `version` is the
 * optimistic-lock guard for concurrent Superadmin edits.
 */

const mongoose = require("mongoose");

// Single source of truth: the approval domain owns the request-type list
// (including SAKIT); the schema must never drift from it.
const { CONFIG_REQUEST_TYPES } = require("../../domain/approval-configuration");

const approvalConfigurationSchema = new mongoose.Schema(
  {
    requestType: {
      type: String,
      enum: CONFIG_REQUEST_TYPES,
      required: true,
      unique: true,
      index: true,
    },
    roles: {
      type: [
        {
          roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },
          approvalLevel: { type: Number, default: 0 },
          canApprove: { type: Boolean, default: false },
          canBeTarget: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    selfApproval: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const ApprovalConfigurationModel = mongoose.model(
  "ApprovalConfiguration",
  approvalConfigurationSchema
);

module.exports = { ApprovalConfigurationModel, CONFIG_REQUEST_TYPES };
