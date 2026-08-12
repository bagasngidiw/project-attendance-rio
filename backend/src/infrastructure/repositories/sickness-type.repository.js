/**
 * SicknessTypeRepository — persistence for the sickness-type master
 * (TODO.md §5). Deactivation preserves history; PENDING types await admin
 * activation.
 */

const { SicknessTypeModel } = require("../models/sickness-type.model");

class SicknessTypeRepository {
  async findByKey(key) {
    return SicknessTypeModel.findOne({ key: key.toUpperCase() });
  }

  /** Null-safe id lookup — used to resolve either an id or a key (FR-002). */
  async findById(id) {
    try {
      return await SicknessTypeModel.findById(id);
    } catch {
      return null;
    }
  }

  async getById(id) {
    return SicknessTypeModel.findById(id);
  }

  /** @param {{ key: string, name: string, description?: string, status?: string, isSystem?: boolean, suggestedBy?: string|null }} input */
  async create({ key, name, description = "", status = "ACTIVE", isSystem = false, suggestedBy = null }) {
    return SicknessTypeModel.create({
      key: key.toUpperCase(),
      name,
      description,
      status,
      isSystem,
      suggestedBy: suggestedBy ?? null,
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
    if (status === "ACTIVE") doc.suggestedBy = null;
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
    return SicknessTypeModel.find(filter).sort({ name: 1, _id: 1 });
  }

  async listActive() {
    return SicknessTypeModel.find({ status: "ACTIVE" }).sort({ name: 1, _id: 1 });
  }
}

module.exports = { SicknessTypeRepository };
