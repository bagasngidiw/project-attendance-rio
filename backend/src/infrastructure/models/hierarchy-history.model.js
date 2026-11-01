const mongoose = require("mongoose");
const { HIERARCHY_EVENTS } = require("../../domain/hierarchy");

const hierarchyHistorySchema = new mongoose.Schema(
  {
    hierarchyId: { type: mongoose.Schema.Types.ObjectId, ref: "Hierarchy", required: true, index: true },
    event: { type: String, enum: HIERARCHY_EVENTS, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorNameSnapshot: { type: String, default: null },
    actorRoleNameSnapshots: { type: [String], default: [] },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    version: { type: Number, default: null },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

hierarchyHistorySchema.index({ hierarchyId: 1, recordedAt: 1 });

const HierarchyHistoryModel = mongoose.model("HierarchyHistory", hierarchyHistorySchema);

module.exports = { HierarchyHistoryModel };
