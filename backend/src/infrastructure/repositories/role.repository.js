/**
 * RoleRepository — persistence access for the Role aggregate, including the
 * FR-011 console mutations (create/update/status) with optimistic locking.
 */

const { RoleModel } = require("../models/role.model");
const { NotFoundError, ConflictError } = require("../../domain/errors");

class RoleRepository {
  async findByIds(ids) {
    return RoleModel.find({ _id: { $in: ids } });
  }

  async findByKey(key) {
    return RoleModel.findOne({ key: key.toUpperCase() });
  }

  async findActiveByIds(ids) {
    return RoleModel.find({ _id: { $in: ids }, status: "ACTIVE" });
  }

  async listAll() {
    return RoleModel.find().sort({ key: 1 });
  }

  async listActive() {
    return RoleModel.find({ status: "ACTIVE" }).sort({ key: 1 });
  }

  async assertExists(id) {
    const role = await RoleModel.findById(id);
    if (!role) {
      throw new NotFoundError("Role not found.", "ROLE_NOT_FOUND");
    }
    return role;
  }

  /**
   * Creates a role (FR-011 §5.2 POST /roles). `version` starts at 1.
   *
   * @param {{ key: string, name: string, description: string, isSystem?: boolean, level?: number, levelLabel?: string, dataScope?: string }} input
   */
  async create({ key, name, description = "", isSystem = false, level = 10, levelLabel = "", dataScope = "SELF" }) {
    return RoleModel.create({
      key: key.toUpperCase(),
      name,
      description,
      isSystem,
      status: "ACTIVE",
      level,
      levelLabel,
      dataScope,
      version: 1,
    });
  }

  /**
   * Updates name/description/level/scope with optimistic locking.
   *
   * @param {string} id
   * @param {{ name?: string, description?: string, level?: number, levelLabel?: string, dataScope?: string, expectedVersion: number }} input
   */
  async update(id, { name, description, level, levelLabel, dataScope, expectedVersion }) {
    const role = await this.assertExists(id);
    this.assertVersion(role, expectedVersion);

    if (name !== undefined) role.name = name.trim();
    if (description !== undefined) role.description = description.trim();
    if (level !== undefined) role.level = level;
    if (levelLabel !== undefined) role.levelLabel = levelLabel;
    if (dataScope !== undefined) role.dataScope = dataScope;
    role.version += 1;
    await role.save();
    return role;
  }

  /**
   * Sets role status (ACTIVE/DISABLED) with optimistic locking.
   *
   * @param {string} id
   * @param {'ACTIVE'|'DISABLED'} status
   * @param {number} expectedVersion
   */
  async setStatus(id, status, expectedVersion) {
    const role = await this.assertExists(id);
    this.assertVersion(role, expectedVersion);

    role.status = status;
    role.version += 1;
    await role.save();
    return role;
  }

  /** Throws 409 when the client's version is stale (lost-update prevention). */
  assertVersion(role, expectedVersion) {
    if (expectedVersion !== undefined && role.version !== expectedVersion) {
      throw new ConflictError(
        `Role "${role.key}" was modified by another administrator. Reload and retry.`,
        "OPTIMISTIC_LOCK_CONFLICT"
      );
    }
  }
}

module.exports = { RoleRepository };
