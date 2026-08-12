/**
 * LeaveTypeRepository — persistence for leave-type configuration (FR-058).
 */

const { LeaveTypeModel } = require("../models/leave-type.model");
const { ConflictError, NotFoundError } = require("../../domain/errors");

class LeaveTypeRepository {
  async findByKey(key) {
    return LeaveTypeModel.findOne({ key: key.toUpperCase() });
  }

  /** Null-safe id lookup — used to resolve either an id or a key. */
  async findById(id) {
    try {
      return await LeaveTypeModel.findById(id);
    } catch {
      return null;
    }
  }

  async create(input) {
    const existing = await this.findByKey(input.key);
    if (existing) {
      throw new ConflictError(
        `A leave type with key "${input.key.toUpperCase()}" already exists.`,
        "LEAVE_TYPE_EXISTS"
      );
    }
    return LeaveTypeModel.create({ ...input, key: input.key.toUpperCase() });
  }

  async getById(id) {
    const doc = await LeaveTypeModel.findById(id);
    if (!doc) throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    return doc;
  }

  async update(id, input) {
    return LeaveTypeModel.findByIdAndUpdate(
      id,
      { $set: { ...input, updatedBy: input.updatedBy ?? null } },
      { returnDocument: "after", runValidators: true }
    );
  }

  async setStatus(id, status, updatedBy) {
    return LeaveTypeModel.findByIdAndUpdate(
      id,
      { $set: { status, updatedBy } },
      { returnDocument: "after" }
    );
  }

  async listAll() {
    return LeaveTypeModel.find().sort({ key: 1 }).lean();
  }

  async listActive() {
    return LeaveTypeModel.find({ status: "ACTIVE" }).sort({ key: 1 }).lean();
  }
}

module.exports = { LeaveTypeRepository };
