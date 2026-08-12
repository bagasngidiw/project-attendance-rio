/**
 * Mongoose schema + model for the `leave_balances` collection (FR-022).
 * One document per user / leave type / year; counters are incremented
 * atomically by the repository.
 */

const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    leaveTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveType",
      required: true,
      index: true,
    },
    year: { type: Number, required: true, index: true },
    entitlementDays: { type: Number, default: 0 },
    adjustmentDays: { type: Number, default: 0 },
    consumedDays: { type: Number, default: 0 },
    reservedDays: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

leaveBalanceSchema.index({ userId: 1, leaveTypeId: 1, year: 1 }, { unique: true });

const LeaveBalanceModel = mongoose.model("LeaveBalance", leaveBalanceSchema);

module.exports = { LeaveBalanceModel };
