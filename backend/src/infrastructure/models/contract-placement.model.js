const mongoose = require("mongoose");

const CONTRACT_PLACEMENT_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const contractPlacementSchema = new mongoose.Schema(
  {
    contractTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "ContractType", required: true, index: true },
    placementId: { type: mongoose.Schema.Types.ObjectId, ref: "Placement", required: true, index: true },
    status: { type: String, enum: CONTRACT_PLACEMENT_STATUSES, default: "ACTIVE", index: true },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false }
);

contractPlacementSchema.index({ contractTypeId: 1, placementId: 1 }, { unique: true });

const ContractPlacementModel = mongoose.model("ContractPlacement", contractPlacementSchema);

module.exports = { ContractPlacementModel, CONTRACT_PLACEMENT_STATUSES };
