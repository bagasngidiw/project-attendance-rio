/**
 * RolePermissionRepository — persistence access for the Role—Permission join
 * collection (used by the FR-011 matrix read model).
 */

const { RolePermissionModel } = require("../models/role-permission.model");

class RolePermissionRepository {
  async listAll() {
    return RolePermissionModel.find().lean();
  }
}

module.exports = { RolePermissionRepository };
