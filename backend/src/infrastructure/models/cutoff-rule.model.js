/**
 * Mongoose schema + model for the `cutoff_rules` collection (FR-063).
 *
 * A cutoff rule restricts when approvals may happen for a request type:
 *   - days: allowed weekdays (0=Sunday..6=Saturday); empty = every weekday
 *   - fromTime/toTime: allowed local window ("HH:mm", 24h)
 *   - dependsOn: optional business dependency tag (PAYROLL_PERIOD, ...)
 */

const mongoose = require("mongoose");

const CUTOFF_REQUEST_TYPES = Object.freeze(["LEAVE", "TRIP", "OVERTIME", "*"]);

const cutoffRuleSchema = new mongoose.Schema(
  {
    requestType: {
      type: String,
      enum: CUTOFF_REQUEST_TYPES,
      required: true,
      unique: true,
      index: true,
    },
    days: { type: [Number], default: [] },
    fromTime: { type: String, default: "" },
    toTime: { type: String, default: "" },
    timezone: { type: String, default: "" },
    dependsOn: { type: String, default: "" },
    enabled: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const CutoffRuleModel = mongoose.model("CutoffRule", cutoffRuleSchema);

module.exports = { CutoffRuleModel, CUTOFF_REQUEST_TYPES };
