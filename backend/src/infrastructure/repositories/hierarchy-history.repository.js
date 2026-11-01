const { HierarchyHistoryModel } = require("../models/hierarchy-history.model");

class HierarchyHistoryRepository {
  async append(input) {
    return HierarchyHistoryModel.create({ ...input, recordedAt: input.recordedAt ?? new Date() });
  }

  async findByHierarchyId(hierarchyId) {
    return HierarchyHistoryModel.find({ hierarchyId }).sort({ recordedAt: 1, _id: 1 }).lean();
  }
}

module.exports = { HierarchyHistoryRepository };
