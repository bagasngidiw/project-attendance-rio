/**
 * ContractTypeRepository — persistence for the contract-type master data
 * (NEW UPDATE TAD SIMBIKA). Deactivation preserves history; no PENDING flow.
 */

const { ContractTypeModel } = require("../models/contract-type.model");

class ContractTypeRepository {
  async findByKey(key) {
    return ContractTypeModel.findOne({ key: key.toUpperCase() });
  }

  /** Null-safe id lookup — used to resolve an id that may not exist. */
  async findById(id) {
    try {
      return await ContractTypeModel.findById(id);
    } catch {
      return null;
    }
  }

  async getById(id) {
    return ContractTypeModel.findById(id);
  }

  /** @param {{ key: string, name: string, description?: string, status?: string, updatedBy?: string|null }} input */
  async create({ key, name, description = "", status = "ACTIVE", updatedBy = null }) {
    return ContractTypeModel.create({
      key: key.toUpperCase(),
      name,
      description,
      status,
      updatedBy: updatedBy ?? null,
    });
  }

  async update(id, { name, description, updatedBy = null }) {
    const doc = await this.getById(id);
    if (!doc) return null;
    if (name !== undefined) doc.name = name.trim();
    if (description !== undefined) doc.description = description.trim();
    doc.updatedBy = updatedBy ?? null;
    await doc.save();
    return doc;
  }

  async setStatus(id, status, updatedBy = null) {
    const doc = await this.getById(id);
    if (!doc) return null;
    doc.status = status;
    doc.updatedBy = updatedBy ?? null;
    await doc.save();
    return doc;
  }

  async list({ search, status } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (search && search.trim()) {
      filter.$or = [
        { name: new RegExp(search.trim(), "i") },
        { key: new RegExp(search.trim(), "i") },
      ];
    }
    return ContractTypeModel.find(filter).sort({ name: 1, _id: 1 });
  }

  async listActive() {
    return ContractTypeModel.find({ status: "ACTIVE" }).sort({ name: 1, _id: 1 });
  }
}

module.exports = { ContractTypeRepository };
