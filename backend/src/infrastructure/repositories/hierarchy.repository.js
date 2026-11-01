const { HierarchyModel } = require("../models/hierarchy.model");
const { ConflictError } = require("../../domain/errors");

class HierarchyRepository {
  async findById(id) {
    return HierarchyModel.findById(id);
  }

  async findByScope(contractTypeId, placementId) {
    return HierarchyModel.findOne({ contractTypeId, placementId });
  }

  async findActiveByScope(contractTypeId, placementId) {
    return HierarchyModel.findOne({ contractTypeId, placementId, status: "ACTIVE" });
  }

  async list({ contractTypeId, placementId, status } = {}) {
    const filter = {};
    if (contractTypeId) filter.contractTypeId = contractTypeId;
    if (placementId) filter.placementId = placementId;
    if (status) filter.status = status;
    return HierarchyModel.find(filter).sort({ updatedAt: -1, _id: -1 }).lean();
  }

  async create({ contractTypeId, placementId, actorId = null }) {
    return HierarchyModel.create({
      contractTypeId,
      placementId,
      status: "DRAFT",
      nodes: [],
      version: 1,
      createdBy: actorId,
      updatedBy: actorId,
    });
  }

  async replaceVersioned(id, expectedVersion, { nodes, status, updatedBy, activatedAt, activatedBy } = {}) {
    const set = { nodes, updatedBy };
    if (status !== undefined) set.status = status;
    if (activatedAt !== undefined) set.activatedAt = activatedAt;
    if (activatedBy !== undefined) set.activatedBy = activatedBy;
    const updated = await HierarchyModel.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: "after", runValidators: true }
    );
    if (!updated) {
      throw new ConflictError(
        "The hierarchy changed while you were editing it. Reload and try again.",
        "HIERARCHY_VERSION_CONFLICT"
      );
    }
    return updated;
  }

  async updateStatus(id, expectedVersion, status, actorId = null) {
    const current = await this.findById(id);
    if (!current) return null;
    return this.replaceVersioned(id, expectedVersion, {
      nodes: current.nodes,
      status,
      updatedBy: actorId,
      activatedAt: status === "ACTIVE" ? new Date() : null,
      activatedBy: status === "ACTIVE" ? actorId : null,
    });
  }
}

module.exports = { HierarchyRepository };
