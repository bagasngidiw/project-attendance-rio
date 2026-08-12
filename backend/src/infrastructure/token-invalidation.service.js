/**
 * TokenInvalidationService — bumps `tokenVersion` for users affected by an
 * RBAC change so their outstanding access tokens are rejected at the next
 * boundary check (FR-002 §4.2 / FR-011 §4.1).
 */

class TokenInvalidationService {
  /**
   * @param {import('./repositories/user.repository').UserRepository} userRepository
   * @param {import('./repositories/user-role.repository').UserRoleRepository} userRoleRepository
   */
  constructor({ userRepository, userRoleRepository }) {
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
  }

  /**
   * Bumps tokenVersion for every user holding the given role(s).
   *
   * @param {string[]} roleIds
   * @returns {Promise<number>} number of affected users
   */
  async invalidateRoleHolders(roleIds) {
    const userIds = new Set();
    for (const roleId of roleIds) {
      const holders = await this.userRoleRepository.userIdsForRole(roleId);
      holders.forEach((id) => userIds.add(id));
    }

    let affected = 0;
    for (const userId of userIds) {
      const user = await this.userRepository.findById(userId);
      if (!user) continue;
      await this.userRepository.bumpTokenVersion(user);
      affected += 1;
    }
    return affected;
  }
}

module.exports = { TokenInvalidationService };
