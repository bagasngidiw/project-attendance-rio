/**
 * Mongoose schema + model for the `placements` collection.
 * Master data for employee placements (NEW UPDATE TAD SIMBIKA).
 * Status only ACTIVE/INACTIVE — no PENDING/suggestion flow.
 */

const mongoose = require("mongoose");

const PLACEMENT_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const placementSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: PLACEMENT_STATUSES,
      default: "ACTIVE",
      index: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PlacementModel = mongoose.model("Placement", placementSchema);

module.exports = { PlacementModel, PLACEMENT_STATUSES };
