const { ContractPlacementModel } = require("../models/contract-placement.model");

class ContractPlacementRepository {
  async listActiveForContract(contractTypeId) {
    return ContractPlacementModel.find({ contractTypeId, status: "ACTIVE" })
      .sort({ placementId: 1, _id: 1 })
      .lean();
  }

  async findActive(contractTypeId, placementId) {
    return ContractPlacementModel.findOne({ contractTypeId, placementId, status: "ACTIVE" });
  }

  async upsert({ contractTypeId, placementId, actorId = null }) {
    return ContractPlacementModel.findOneAndUpdate(
      { contractTypeId, placementId },
      { $set: { status: "ACTIVE", updatedBy: actorId }, $setOnInsert: { createdBy: actorId, version: 1 } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }
}

module.exports = { ContractPlacementRepository };
