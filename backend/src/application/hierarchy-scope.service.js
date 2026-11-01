/**
 * Resolves record visibility from existing RBAC role data scopes and the
 * contract/placement hierarchy chart. Permissions are checked by routes; this
 * service only answers which user IDs are inside the actor's data boundary.
 */

const { NotFoundError } = require("../domain/errors");

const SCOPE_ORDER = Object.freeze({
  SELF: 0,
  DIRECT_SUBORDINATES: 1,
  DIRECT_AND_INDIRECT_SUBORDINATES: 2,
  DEPARTMENT: 3,
  ALL_EMPLOYEES: 4,
});

class HierarchyScopeService {
  constructor({ hierarchyService, userRepository, userRoleRepository, roleRepository }) {
    this.hierarchyService = hierarchyService;
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
    this.roleRepository = roleRepository;
  }

  /**
   * Returns null for company-wide access, otherwise a concrete allowed-user
   * list. The list always includes the actor for self/team scopes.
   */
  async resolveVisibleUserIds(actor = {}) {
    const actorId = actor.actorId ?? actor.userId;
    if (!actorId) throw new NotFoundError("Authenticated user not found.", "USER_NOT_FOUND");
    const roleIds = await this.userRoleRepository.roleIdsForUser(actorId);
    const roles = roleIds.length ? await this.roleRepository.findActiveByIds(roleIds) : [];
    const scopes = roles.map((role) => role.dataScope ?? "SELF");
    if (actor.actorRoleKeys?.includes("SUPER_ADMIN")) return null;
    if (scopes.some((scope) => scope === "ALL_EMPLOYEES")) return null;

    const actorUser = await this.userRepository.findById(actorId);
    if (!actorUser) throw new NotFoundError("Authenticated user not found.", "USER_NOT_FOUND");

    const allowed = new Set([String(actorId)]);
    if (scopes.some((scope) => scope === "DEPARTMENT") && !actorUser.departmentId) return null;
    if (scopes.some((scope) => scope === "DEPARTMENT") && actorUser.departmentId) {
      const { items } = await this.userRepository.list({
        status: "ACTIVE",
        departmentId: actorUser.departmentId,
        page: 1,
        pageSize: 10000,
      });
      items.forEach((user) => allowed.add(String(user.id ?? user._id)));
    }

    const widestHierarchyScope = scopes.reduce(
      (current, scope) => (SCOPE_ORDER[scope] > SCOPE_ORDER[current] ? scope : current),
      "SELF"
    );
    if (widestHierarchyScope === "DIRECT_SUBORDINATES" || widestHierarchyScope === "DIRECT_AND_INDIRECT_SUBORDINATES") {
      let ids = await this.hierarchyService.getDescendantUserIds(actorId, {
        includeSelf: true,
        recursive: widestHierarchyScope === "DIRECT_AND_INDIRECT_SUBORDINATES",
      });
      // Legacy compatibility: demo/old users may not have a chart yet. Use
      // the existing reporting line only until their contract chart exists.
      if (ids.length === 1) {
        ids = await this.legacyDescendantUserIds(actorId, widestHierarchyScope === "DIRECT_AND_INDIRECT_SUBORDINATES");
      }
      ids.forEach((id) => allowed.add(String(id)));
    }
    return [...allowed];
  }

  async legacyDescendantUserIds(actorId, recursive) {
    const result = [String(actorId)];
    let frontier = [String(actorId)];
    do {
      const next = [];
      for (const managerId of frontier) {
        const reports = await this.userRepository.findDirectReports(managerId);
        reports.forEach((user) => {
          const id = String(user.id ?? user._id);
          if (!result.includes(id)) {
            result.push(id);
            next.push(id);
          }
        });
      }
      frontier = recursive ? next : [];
    } while (frontier.length);
    return result;
  }

  async assertTargetVisible(actor, targetUserId) {
    const visible = await this.resolveVisibleUserIds(actor);
    if (visible && !visible.includes(String(targetUserId))) {
      throw new NotFoundError("Record not found.", "NOT_FOUND");
    }
    return true;
  }
}

module.exports = { HierarchyScopeService, SCOPE_ORDER };
