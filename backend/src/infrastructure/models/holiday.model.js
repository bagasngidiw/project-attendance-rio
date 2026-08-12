/**
 * Mongoose schema + model for the `holidays` collection (FR-059).
 * Dates are stored as UTC instants of local midnight for the company
 * timezone; deactivation preserves history.
 */

const mongoose = require("mongoose");

const HOLIDAY_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    name: { type: String, required: true, trim: true },
    repeatYearly: { type: Boolean, default: false },
    status: { type: String, enum: HOLIDAY_STATUSES, default: "ACTIVE", index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const HolidayModel = mongoose.model("Holiday", holidaySchema);

module.exports = { HolidayModel, HOLIDAY_STATUSES };
