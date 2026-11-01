const mongoose = require("mongoose");
const { HIERARCHY_STATUSES } = require("../../domain/hierarchy");

const hierarchyNodeSchema = new mongoose.Schema(
  {
    nodeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    parentNodeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const hierarchySchema = new mongoose.Schema(
  {
    contractTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "ContractType", required: true, index: true },
    placementId: { type: mongoose.Schema.Types.ObjectId, ref: "Placement", required: true, index: true },
    status: { type: String, enum: HIERARCHY_STATUSES, default: "DRAFT", index: true },
    nodes: { type: [hierarchyNodeSchema], default: [] },
    version: { type: Number, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

hierarchySchema.index({ contractTypeId: 1, placementId: 1 }, { unique: true });

const HierarchyModel = mongoose.model("Hierarchy", hierarchySchema);

module.exports = { HierarchyModel, hierarchyNodeSchema };
