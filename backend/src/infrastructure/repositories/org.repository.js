/**
 * OrgRepository — persistence for departments and positions (FR-024).
 * Duplicate names are rejected with ORG_DUPLICATE (case-insensitive).
 */

const { DepartmentModel } = require("../models/department.model");
const { PositionModel } = require("../models/position.model");
const { ConflictError, NotFoundError } = require("../../domain/errors");

/** Case-insensitive duplicate check on a name. */
async function assertNameAvailable(Model, name) {
  const existing = await Model.findOne({
    name: new RegExp(`^${escapeRegExp(name)}$`, "i"),
  }).lean();
  return existing ?? null;
}

class OrgRepository {
  /* ---------------- Departments ---------------- */

  async createDepartment({ name, code, description, createdBy }) {
    const existing = await assertNameAvailable(DepartmentModel, name);
    if (existing) {
      throw new ConflictError("A department with this name already exists.", "ORG_DUPLICATE");
    }
    return DepartmentModel.create({ name, code, description, createdBy });
  }

  async getDepartment(id) {
    const doc = await DepartmentModel.findById(id);
    if (!doc) throw new NotFoundError("Department not found.", "DEPARTMENT_NOT_FOUND");
    return doc;
  }

  async updateDepartment(id, { name, code, description, updatedBy }) {
    const existing = await assertNameAvailable(DepartmentModel, name);
    if (existing && String(existing._id) !== String(id)) {
      throw new ConflictError("A department with this name already exists.", "ORG_DUPLICATE");
    }
    return DepartmentModel.findByIdAndUpdate(
      id,
      { $set: { name, code, description, updatedBy } },
      { returnDocument: "after", runValidators: true }
    );
  }

  async setDepartmentStatus(id, status, updatedBy) {
    return DepartmentModel.findByIdAndUpdate(
      id,
      { $set: { status, updatedBy } },
      { returnDocument: "after" }
    );
  }

  async listDepartments() {
    return DepartmentModel.find().sort({ name: 1 }).lean();
  }

  async listActiveDepartments() {
    return DepartmentModel.find({ status: "ACTIVE" }).sort({ name: 1 }).lean();
  }

  /* ---------------- Positions ---------------- */

  async createPosition({ name, description, createdBy }) {
    const existing = await assertNameAvailable(PositionModel, name);
    if (existing) {
      throw new ConflictError("A position with this name already exists.", "ORG_DUPLICATE");
    }
    return PositionModel.create({ name, description, createdBy });
  }

  async getPosition(id) {
    const doc = await PositionModel.findById(id);
    if (!doc) throw new NotFoundError("Position not found.", "POSITION_NOT_FOUND");
    return doc;
  }

  async updatePosition(id, { name, description, updatedBy }) {
    const existing = await assertNameAvailable(PositionModel, name);
    if (existing && String(existing._id) !== String(id)) {
      throw new ConflictError("A position with this name already exists.", "ORG_DUPLICATE");
    }
    return PositionModel.findByIdAndUpdate(
      id,
      { $set: { name, description, updatedBy } },
      { returnDocument: "after", runValidators: true }
    );
  }

  async setPositionStatus(id, status, updatedBy) {
    return PositionModel.findByIdAndUpdate(
      id,
      { $set: { status, updatedBy } },
      { returnDocument: "after" }
    );
  }

  async listPositions() {
    return PositionModel.find().sort({ name: 1 }).lean();
  }

  async listActivePositions() {
    return PositionModel.find({ status: "ACTIVE" }).sort({ name: 1 }).lean();
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { OrgRepository };
