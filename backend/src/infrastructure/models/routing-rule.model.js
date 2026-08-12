/**
 * Mongoose schema + model for the `routing_rules` collection (FR-042 §7).
 *
 * Per-request-type approval routing configuration (single/multi-level,
 * fallback, enabled). Changes are audited via SETTINGS.CHANGED at the
 * application layer.
 */

const mongoose = require("mongoose");

const routingRuleSchema = new mongoose.Schema(
  {
    requestType: {
      type: String,
      enum: ["LEAVE", "OVERTIME", "TRIP"],
      required: true,
      unique: true,
    },
    levels: {
      type: [{ source: { type: String, required: true } }],
      required: true,
    },
    fallback: {
      type: String,
      enum: ["ACTIVE_HR_ADMIN", "SUPER_ADMIN"],
      default: "ACTIVE_HR_ADMIN",
    },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

const RoutingRuleModel = mongoose.model("RoutingRule", routingRuleSchema);

module.exports = { RoutingRuleModel };
