/**
 * Mongoose schema + model for the `leave_types` collection (FR-058).
 * Leave types are configuration; deactivation preserves history.
 */

const mongoose = require("mongoose");

const LEAVE_TYPE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE", "PENDING"]);

const leaveTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isBalanceBased: { type: Boolean, default: false },
    maxDaysPerRequest: { type: Number, default: null },
    requiredSupportingInfo: { type: Boolean, default: false },
    status: { type: String, enum: LEAVE_TYPE_STATUSES, default: "ACTIVE", index: true },
    isSystem: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const LeaveTypeModel = mongoose.model("LeaveType", leaveTypeSchema);

module.exports = { LeaveTypeModel, LEAVE_TYPE_STATUSES };
