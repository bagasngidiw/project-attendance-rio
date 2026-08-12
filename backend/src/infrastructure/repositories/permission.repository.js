/**
 * PermissionRepository — persistence access for the permission registry.
 */

const { PermissionModel } = require("../models/permission.model");
const { RolePermissionModel } = require("../models/role-permission.model");

class PermissionRepository {
  async listAll() {
    return PermissionModel.find({ status: "ACTIVE" }).sort({ module: 1, key: 1 });
  }

  /**
   * Bulk upserts registry definitions (idempotent seed helper).
   *
   * @param {Array<{key: string, module: string, description: string}>} definitions
   */
  async syncDefinitions(definitions) {
    const ops = definitions.map((def) => ({
      updateOne: {
        filter: { key: def.key },
        update: {
          $setOnInsert: {
            key: def.key,
            module: def.module,
            description: def.description,
            status: "ACTIVE",
          },
        },
        upsert: true,
      },
    }));
    await PermissionModel.bulkWrite(ops);
  }

  /**
   * Returns the permission keys granted to a set of role ids.
   *
   * @param {Array<string>} roleIds
   * @returns {Promise<Set<string>>}
   */
  async permissionKeysForRoles(roleIds) {
    const rows = await RolePermissionModel.find({
      roleId: { $in: roleIds },
    });
    return new Set(rows.map((row) => row.permissionKey));
  }

  async assignToRole(roleId, permissionKeys, grantedBy = null) {
    const ops = [...new Set(permissionKeys)].map((key) => ({
      updateOne: {
        filter: { roleId, permissionKey: key },
        update: { $setOnInsert: { roleId, permissionKey: key, grantedBy, grantedAt: new Date() } },
        upsert: true,
      },
    }));
    if (ops.length > 0) await RolePermissionModel.bulkWrite(ops);
  }

  async replaceForRole(roleId, permissionKeys, grantedBy = null) {
    await RolePermissionModel.deleteMany({ roleId });
    await this.assignToRole(roleId, permissionKeys, grantedBy);
  }

  /**
   * Applies a permission diff to a role (FR-011 §4.1). `added` keys are
   * upserted; `removed` keys are deleted from the join collection.
   *
   * @param {string} roleId
   * @param {{ added: string[], removed: string[] }} diff
   * @param {string|null} grantedBy
   */
  async applyDiffToRole(roleId, { added, removed }, grantedBy = null) {
    if (removed.length > 0) {
      await RolePermissionModel.deleteMany({
        roleId,
        permissionKey: { $in: removed },
      });
    }
    if (added.length > 0) {
      await this.assignToRole(roleId, added, grantedBy);
    }
  }

  /**
   * Returns the granted permission keys for a single role.
   *
   * @param {string} roleId
   * @returns {Promise<Set<string>>}
   */
  async permissionKeysForRole(roleId) {
    const rows = await RolePermissionModel.find({ roleId });
    return new Set(rows.map((row) => row.permissionKey));
  }
}

module.exports = { PermissionRepository };
