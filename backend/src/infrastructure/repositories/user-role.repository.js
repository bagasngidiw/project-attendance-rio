/**
 * UserRoleRepository — persistence access for the User—Role join.
 *
 * The join collection (`user_roles`) is the source of truth. Every role
 * mutation also mirrors the role ids onto the User document (`roleIds`) so the
 * collections stay relationally consistent (the User doc carries its role refs).
 */

const { UserRoleModel } = require("../models/user-role.model");
const { UserModel } = require("../models/user.model");

class UserRoleRepository {
  /**
   * @param {string} userId
   * @returns {Promise<Array<{ roleId: string, roleKey?: string }>>}
   */
  async findByUserId(userId) {
    return UserRoleModel.find({ userId }).sort({ assignedAt: 1 });
  }

  async roleIdsForUser(userId) {
    const rows = await UserRoleModel.find({ userId });
    return rows.map((row) => row.roleId);
  }

  /**
   * Replaces a user's role set with a new set (design §5.3 PUT semantics).
   * The User document's `roleIds` mirror is updated in the same step.
   *
   * @param {string} userId
   * @param {string[]} roleIds
   * @param {string|null} assignedBy
   */
  async replaceRolesForUser(userId, roleIds, assignedBy = null) {
    await UserRoleModel.deleteMany({ userId });
    if (roleIds.length > 0) {
      const rows = roleIds.map((roleId) => ({
        userId,
        roleId,
        assignedBy,
        assignedAt: new Date(),
      }));
      await UserRoleModel.insertMany(rows);
    }
    await this.syncRoleIds(userId);
  }

  /**
   * Copies the join collection into the User document's `roleIds` mirror.
   *
   * @param {string} userId
   */
  async syncRoleIds(userId) {
    const rows = await UserRoleModel.find({ userId }).select("roleId").lean();
    const roleIds = rows.map((row) => row.roleId);
    await UserModel.updateOne({ _id: userId }, { $set: { roleIds } });
  }

  /**
   * Returns the distinct user ids currently holding a role.
   *
   * @param {string} roleId
   * @returns {Promise<string[]>}
   */
  async userIdsForRole(roleId) {
    const rows = await UserRoleModel.find({ roleId }).select("userId").lean();
    return [...new Set(rows.map((row) => String(row.userId)))];
  }

  /**
   * FR-001: every user→role pair for a set of role ids — used to resolve
   * eligible approvers with their role label.
   *
   * @param {string[]} roleIds
   * @returns {Promise<Array<{ userId: string, roleId: string }>>}
   */
  async userRolePairsForRoleIds(roleIds) {
    if (!roleIds || roleIds.length === 0) return [];
    const rows = await UserRoleModel.find({ roleId: { $in: roleIds } })
      .select("userId roleId")
      .lean();
    return rows.map((row) => ({ userId: String(row.userId), roleId: String(row.roleId) }));
  }
}

module.exports = { UserRoleRepository };
