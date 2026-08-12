/**
 * RbacService — role & permission resolution and role assignment (FR-002).
 *
 * Deliberately independent of HTTP. The presentation layer translates these
 * results into API responses and the authentication middleware consumes the
 * resolved effective permissions for every protected request.
 */

const {
  computeEffectivePermissions,
  assertSuperAdminSafe,
} = require("../domain/model");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../domain/errors");

class RbacService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/repositories/permission.repository').PermissionRepository} deps.permissionRepository
   * @param {import('../application/audit.service').AuditService} deps.auditService
   */
  constructor({
    userRepository,
    roleRepository,
    userRoleRepository,
    permissionRepository,
    auditService,
  }) {
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.permissionRepository = permissionRepository;
    this.auditService = auditService;
  }

  /**
   * Resolves the effective permission keys for a user = union across all
   * ACTIVE assigned roles (design §4.2).
   *
   * @param {string} userId
   * @returns {Promise<string[]>} sorted unique permission keys
   */
  async getEffectivePermissions(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];

    const roles = await this.roleRepository.findActiveByIds(roleIds);
    if (roles.length === 0) return [];

    // Union across every ACTIVE role (design §4.2). Disabled roles are
    // filtered out by findActiveByIds, so a direct permission-key union is
    // equivalent to the domain `computeEffectivePermissions` helper.
    const activeRoleIds = roles.map((role) => role.id);
    const keys = await this.permissionRepository.permissionKeysForRoles(
      activeRoleIds
    );
    return [...keys].sort();
  }

  /**
   * Lists all roles with their granted permission keys (design §5.1).
   *
   * @returns {Promise<Array<{ id: string, key: string, name: string, description: string, isSystem: boolean, status: string, permissions: string[] }>>}
   */
  async listRoles() {
    const roles = await this.roleRepository.listAll();
    return Promise.all(
      roles.map(async (role) => {
        const keys = await this.permissionRepository.permissionKeysForRoles([
          role.id,
        ]);
        return {
          id: role.id,
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          status: role.status,
          level: role.level ?? 10,
          levelLabel: role.levelLabel ?? "",
          dataScope: role.dataScope ?? "SELF",
          version: role.version,
          permissions: [...keys].sort(),
        };
      })
    );
  }

  /**
   * Returns a single role with its permissions.
   *
   * @param {string} roleId
   */
  async getRole(roleId) {
    const role = await this.roleRepository.assertExists(roleId);
    const keys = await this.permissionRepository.permissionKeysForRoles([roleId]);
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      level: role.level ?? 10,
      levelLabel: role.levelLabel ?? "",
      dataScope: role.dataScope ?? "SELF",
      permissions: [...keys].sort(),
    };
  }

  /**
   * Assigns/replaces a user's role set (design §5.3 PUT /roles).
   * Bumps tokenVersion to invalidate outstanding access tokens and records
   * the change for audit.
   *
   * @param {string} userId
   * @param {string[]} roleIds
   * @param {{ actorId: string|null, actorUsername?: string, ip?: string, userAgent?: string }} actor
   */
  async assignRoles(userId, roleIds, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    const uniqueRoleIds = [...new Set(roleIds)];

    if (uniqueRoleIds.length === 0) {
      throw new ValidationError("At least one role must be assigned.", {
        field: "roleIds",
      });
    }

    const roles = await this.roleRepository.findByIds(uniqueRoleIds);
    if (roles.length !== uniqueRoleIds.length) {
      throw new NotFoundError("One or more roles do not exist.", "ROLE_NOT_FOUND");
    }
    const disabled = roles.find((role) => role.status !== "ACTIVE");
    if (disabled) {
      throw new ConflictError(
        `Role "${disabled.key}" is disabled and cannot be assigned.`,
        "ROLE_DISABLED"
      );
    }

    // Safety guard: never leave the last SUPER_ADMIN without the role.
    const currentMemberships = await this.userRoleRepository.findByUserId(userId);
    const allRoles = await this.roleRepository.listAll();
    const roleKeysById = new Map(allRoles.map((role) => [role.id, role.key]));
    assertSuperAdminSafe(currentMemberships, roleKeysById, uniqueRoleIds);

    const previousRoleIds = currentMemberships.map((m) => m.roleId.toString());
    await this.userRoleRepository.replaceRolesForUser(
      userId,
      uniqueRoleIds,
      actor.actorId ?? null
    );

    await this.userRepository.bumpTokenVersion(user);
    const assignedKeys = uniqueRoleIds.map(
      (id) => roleKeysById.get(id) ?? "?"
    );

    await this.auditService.record({
      action: "RBAC.ROLES_ASSIGNED",
      actor: {
        userId: actor.actorId,
        roleKeys: actor.actorRoleKeys ?? [],
      },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: {
        previousRoleIds,
        assignedRoleIds: uniqueRoleIds,
        assignedRoleKeys: assignedKeys,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { userId, roles: assignedKeys };
  }

  /**
   * Effective permission set for a user (design §5.1).
   *
   * @param {string} userId
   * @returns {Promise<{ userId: string, permissions: string[] }>}
   */
  async getUserEffectivePermissions(userId) {
    await this.userRepository.assertExists(userId);
    const permissions = await this.getEffectivePermissions(userId);
    return { userId, permissions };
  }

  /**
   * Lists registered permissions grouped by module (design §5.1).
   *
   * @returns {Promise<Array<{ module: string, permissions: Array<{ key: string, description: string }> }>>}
   */
  async listPermissionsGrouped() {
    const all = await this.permissionRepository.listAll();
    const grouped = new Map();
    for (const perm of all) {
      if (!grouped.has(perm.module)) grouped.set(perm.module, []);
      grouped
        .get(perm.module)
        .push({ key: perm.key, description: perm.description });
    }
    return [...grouped.entries()].map(([module, permissions]) => ({
      module,
      permissions,
    }));
  }
}

module.exports = { RbacService };
