/**
 * RoleAdminService — the FR-011 console use cases.
 *
 * Manages roles, the permission matrix, and effective-permission inspection.
 * Every mutation validates console invariants, applies the change, bumps
 * affected users' tokenVersion, and emits RBAC.* audit events.
 */

const {
  assertSystemRoleAllowed,
  assertSuperAdminPermissionsSafe,
  computePermissionDiff,
  validatePermissionKeys,
  validateRoleCreateInput,
} = require("../domain/rbac-admin-rules");
const {
  buildChecklistGroups,
  buildValidationReport,
  dependencyWarnings,
  highPrivilegeWarnings,
  DEPENDENCY_MAP,
  HIGH_PRIVILEGE_PERMISSIONS,
} = require("../domain/permission-checklist");
const {
  ROLE_DATA_SCOPES,
  DEFAULT_ROLE_LEVEL,
  DEFAULT_ROLE_SCOPE,
  LEVEL_SCOPE_SUGGESTIONS,
  defaultScopeForLevel,
  validateRoleLevel,
} = require("../domain/role-level");
const { ROLE_TEMPLATES } = require("../domain/role-templates");
const {
  ConflictError,
  ValidationError,
  NotFoundError,
} = require("../domain/errors");

class RoleAdminService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/permission.repository').PermissionRepository} deps.permissionRepository
   * @param {import('../infrastructure/repositories/role-permission.repository').RolePermissionRepository} deps.rolePermissionRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/token-invalidation.service').TokenInvalidationService} deps.tokenInvalidation
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
    userRoleRepository,
    userRepository,
    tokenInvalidation,
    auditService,
  }) {
    this.roleRepository = roleRepository;
    this.permissionRepository = permissionRepository;
    this.rolePermissionRepository = rolePermissionRepository;
    this.userRoleRepository = userRoleRepository;
    this.userRepository = userRepository;
    this.tokenInvalidation = tokenInvalidation;
    this.auditService = auditService;
  }

  /**
   * Loads the permission matrix grouped by module with `grantedTo` role ids
   * (FR-011 §5.1 GET /matrix).
   *
   * @returns {Promise<Array<{ module: string, permissions: Array<{ key: string, description: string, grantedTo: string[] }> }>>}
   */
  async getMatrix() {
    const [permissions, roles, rolePermissions] = await Promise.all([
      this.permissionRepository.listAll(),
      this.roleRepository.listAll(),
      this.loadAllRolePermissions(),
    ]);

    const roleIdToGranted = new Map();
    for (const row of rolePermissions) {
      const key = String(row.roleId);
      if (!roleIdToGranted.has(key)) roleIdToGranted.set(key, new Set());
      roleIdToGranted.get(key).add(row.permissionKey);
    }

    const rolesById = new Map(roles.map((role) => [String(role.id), role]));

    return groupByModule(permissions, (perm) => {
      const grantedTo = [];
      for (const [roleId, keys] of roleIdToGranted) {
        if (keys.has(perm.key) && rolesById.has(roleId)) {
          grantedTo.push(roleId);
        }
      }
      return grantedTo;
    });
  }

  /** Loads every role_permissions row (bounded by the registry size). */
  async loadAllRolePermissions() {
    return this.rolePermissionRepository.listAll();
  }

  /**
   * Creates a role (FR-011 §5.2 POST /roles; FR-064 accepts level/scope).
   *
   * @param {{ name: string, description: string, permissions: string[], level?: number, levelLabel?: string, dataScope?: string, copyFromRoleId?: string, templateKey?: string }} input
   * @param {object} actor
   */
  async createRole(input, actor = {}) {
    const resolved = await this.resolveRoleSources(input);
    const validated = validateRoleCreateInput({
      key: toRoleKey(resolved.name),
      name: resolved.name,
      description: resolved.description,
      permissions: resolved.permissions,
      level: resolved.level,
      levelLabel: resolved.levelLabel,
      dataScope: resolved.dataScope,
    });

    const existing = await this.roleRepository.findByKey(validated.key);
    if (existing) {
      throw new ConflictError(
        `A role with key "${validated.key}" already exists.`,
        "ROLE_KEY_EXISTS"
      );
    }

    const role = await this.roleRepository.create({
      key: validated.key,
      name: validated.name,
      description: validated.description,
      level: validated.level,
      levelLabel: validated.levelLabel,
      dataScope: validated.dataScope,
    });
    await this.permissionRepository.assignToRole(role.id, validated.permissions, actor.actorId);

    await this.auditService.record({
      action: "RBAC.ROLE_CREATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ROLE", id: role.id, summary: role.key },
      outcome: "SUCCESS",
      metadata: {
        roleKey: role.key,
        level: validated.level,
        dataScope: validated.dataScope,
        permissions: validated.permissions,
        source: resolved.source,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toRoleDto(role, validated.permissions);
  }

  /**
   * Resolves the effective creation payload when `copyFromRoleId` or
   * `templateKey` is supplied (FR-064 V.6). Templates never inject hidden
   * permissions; copied roles inherit the source's permissions + level/scope
   * and remain fully editable before save.
   *
   * @param {{ name: string, permissions?: string[], copyFromRoleId?: string, templateKey?: string, level?: number, dataScope?: string }} input
   */
  async resolveRoleSources(input) {
    const result = {
      name: input.name,
      description: input.description ?? "",
      permissions: input.permissions ?? [],
      level: input.level,
      levelLabel: input.levelLabel,
      dataScope: input.dataScope,
      source: "scratch",
    };

    if (input.templateKey) {
      const template = ROLE_TEMPLATES.find((t) => t.key === input.templateKey);
      if (!template) {
        throw new ValidationError(`Unknown role template "${input.templateKey}".`, {
          field: "templateKey",
        });
      }
      result.permissions = result.permissions.length
        ? result.permissions
        : [...(template.basePermissions ?? [])];
      if (result.level === undefined) result.level = template.baseLevel;
      if (result.dataScope === undefined) result.dataScope = template.baseScope;
      result.source = `template:${template.key}`;
    }

    if (input.copyFromRoleId) {
      const source = await this.roleRepository.assertExists(input.copyFromRoleId);
      const sourceKeys = await this.permissionRepository.permissionKeysForRole(
        input.copyFromRoleId
      );
      result.permissions = result.permissions.length
        ? result.permissions
        : [...sourceKeys];
      if (result.level === undefined) result.level = source.level ?? DEFAULT_ROLE_LEVEL;
      if (result.levelLabel === undefined) result.levelLabel = source.levelLabel ?? "";
      if (result.dataScope === undefined) result.dataScope = source.dataScope ?? DEFAULT_ROLE_SCOPE;
      result.source = `copy:${source.key}`;
    }

    return result;
  }

  /**
   * Updates role name/description/level/scope (optimistic lock). Level or
   * scope changes invalidate role holders and are audited separately.
   *
   * @param {string} roleId
   * @param {{ name?: string, description?: string, level?: number, levelLabel?: string, dataScope?: string, expectedVersion: number }} input
   * @param {object} actor
   */
  async updateRole(roleId, input, actor = {}) {
    const role = await this.roleRepository.assertExists(roleId);
    assertSystemRoleAllowed(role, "update");

    if (input.name && input.name.trim().length < 2) {
      throw new ValidationError("Role name must be at least 2 characters.", {
        field: "name",
      });
    }

    // Validate level/scope when provided (FR-064).
    const levelPatch = {
      level: input.level ?? role.level ?? DEFAULT_ROLE_LEVEL,
      levelLabel: input.levelLabel !== undefined ? input.levelLabel : (role.levelLabel ?? ""),
      dataScope: input.dataScope ?? role.dataScope ?? DEFAULT_ROLE_SCOPE,
    };
    const validatedLevel = validateRoleLevel(levelPatch);

    const before = {
      name: role.name,
      description: role.description,
      level: role.level,
      levelLabel: role.levelLabel,
      dataScope: role.dataScope,
    };
    const updated = await this.roleRepository.update(roleId, {
      name: input.name,
      description: input.description,
      level: validatedLevel.level,
      levelLabel: validatedLevel.levelLabel,
      dataScope: validatedLevel.dataScope,
      expectedVersion: input.expectedVersion,
    });

    const levelOrScopeChanged =
      before.level !== updated.level ||
      before.levelLabel !== updated.levelLabel ||
      before.dataScope !== updated.dataScope;

    let affectedUsers = [];
    if (levelOrScopeChanged) {
      affectedUsers = await this.tokenInvalidation.invalidateRoleHolders([roleId]);
    }

    await this.auditService.record({
      action: levelOrScopeChanged ? "RBAC.ROLE_LEVEL_CHANGED" : "RBAC.ROLE_UPDATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ROLE", id: roleId, summary: updated.key },
      outcome: "SUCCESS",
      metadata: {
        before,
        after: {
          name: updated.name,
          description: updated.description,
          level: updated.level,
          levelLabel: updated.levelLabel,
          dataScope: updated.dataScope,
        },
        affectedUsers,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    const permissions = await this.permissionRepository.permissionKeysForRole(roleId);
    return this.toRoleDto(updated, [...permissions]);
  }

  /**
   * FR-064: role console metadata — checklist groups, templates, dependency
   * map, high-privilege set, level schema.
   */
  async getMeta() {
    return {
      groups: buildChecklistGroups(),
      templates: ROLE_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        baseLevel: t.baseLevel,
        baseScope: t.baseScope,
        basePermissions: t.basePermissions ? [...t.basePermissions].sort() : ["*"],
      })),
      dependencyMap: DEPENDENCY_MAP,
      highPrivilegePermissions: HIGH_PRIVILEGE_PERMISSIONS,
      roleLevel: {
        dataScopes: ROLE_DATA_SCOPES,
        defaultLevel: DEFAULT_ROLE_LEVEL,
        defaultScope: DEFAULT_ROLE_SCOPE,
        scopeSuggestions: LEVEL_SCOPE_SUGGESTIONS,
      },
    };
  }

  /**
   * FR-064: validates a prospective role (permissions + dependencies +
   * high-privilege warnings) WITHOUT persisting anything.
   *
   * @param {{ permissions: string[], level?: number, dataScope?: string }} input
   */
  async validateRole(input) {
    const keys = validatePermissionKeys(input.permissions ?? []);
    const level = validateRoleLevel({
      level: input.level,
      levelLabel: input.levelLabel,
      dataScope: input.dataScope,
    });
    const report = buildValidationReport({ permissions: keys });
    return {
      permissions: keys.sort(),
      level: level.level,
      dataScope: level.dataScope,
      ...report.warnings,
    };
  }

  /**
   * FR-064: effective-access preview for a role (menus/actions/approval/
   * reports/export/admin) — read-only, used before save.
   *
   * @param {string} roleId
   */
  async previewRole(roleId) {
    const role = await this.roleRepository.assertExists(roleId);
    const keys = [...(await this.permissionRepository.permissionKeysForRole(roleId))].sort();
    const report = buildValidationReport({ permissions: keys });
    return {
      role: {
        key: role.key,
        name: role.name,
        level: role.level ?? DEFAULT_ROLE_LEVEL,
        levelLabel: role.levelLabel ?? "",
        dataScope: role.dataScope ?? DEFAULT_ROLE_SCOPE,
      },
      ...report,
    };
  }

  /**
   * FR-064: copies an existing role's permissions + level/scope into a NEW
   * role draft (still editable before save; nothing persisted).
   *
   * @param {string} sourceId
   */
  async copyRole(sourceId) {
    const source = await this.roleRepository.assertExists(sourceId);
    const keys = [...(await this.permissionRepository.permissionKeysForRole(sourceId))].sort();
    return {
      name: `${source.name} (Copy)`,
      description: source.description,
      level: source.level ?? DEFAULT_ROLE_LEVEL,
      levelLabel: source.levelLabel ?? "",
      dataScope: source.dataScope ?? DEFAULT_ROLE_SCOPE,
      permissions: keys,
      source: { id: source.id, key: source.key },
    };
  }

  /**
   * Applies a permission diff to a role (FR-011 §4.1 PATCH /permissions).
   *
   * @param {string} roleId
   * @param {{ permissions: string[], reason?: string, expectedVersion: number }} input
   * @param {object} actor
   */
  async setRolePermissions(roleId, input, actor = {}) {
    const role = await this.roleRepository.assertExists(roleId);
    this.roleRepository.assertVersion(role, input.expectedVersion);

    const nextPermissions = validatePermissionKeys(input.permissions);
    assertSuperAdminPermissionsSafe(role, nextPermissions);

    const current = await this.permissionRepository.permissionKeysForRole(roleId);
    const currentKeys = [...current].sort();
    const diff = computePermissionDiff(currentKeys, nextPermissions);

    await this.permissionRepository.applyDiffToRole(
      roleId,
      diff,
      actor.actorId
    );

    // Bump role version so the client's next read reflects the change.
    role.version += 1;
    await role.save();

    const affectedUsers = await this.tokenInvalidation.invalidateRoleHolders([roleId]);

    await this.auditService.record({
      action: "RBAC.PERMISSION_CHANGED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ROLE", id: roleId, summary: role.key },
      outcome: "SUCCESS",
      metadata: {
        roleKey: role.key,
        added: diff.added,
        removed: diff.removed,
        reason: input.reason ?? "",
        affectedUsers,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    const finalKeys = await this.permissionRepository.permissionKeysForRole(roleId);
    return {
      roleId,
      permissions: [...finalKeys].sort(),
      appliedAt: new Date().toISOString(),
      affectedUsers,
    };
  }

  /**
   * Disables a role (no hard delete; system roles protected).
   *
   * @param {string} roleId
   * @param {{ expectedVersion: number }} input
   * @param {object} actor
   */
  async disableRole(roleId, input, actor = {}) {
    const role = await this.roleRepository.assertExists(roleId);
    assertSystemRoleAllowed(role, "disable");

    const updated = await this.roleRepository.setStatus(roleId, "DISABLED", input.expectedVersion);
    const affectedUsers = await this.tokenInvalidation.invalidateRoleHolders([roleId]);

    await this.auditService.record({
      action: "RBAC.ROLE_DISABLED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ROLE", id: roleId, summary: updated.key },
      outcome: "SUCCESS",
      metadata: { roleKey: updated.key, affectedUsers },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { roleId, status: "DISABLED", affectedUsers };
  }

  /**
   * Enables a previously disabled role.
   *
   * @param {string} roleId
   * @param {{ expectedVersion: number }} input
   * @param {object} actor
   */
  async enableRole(roleId, input, actor = {}) {
    const role = await this.roleRepository.assertExists(roleId);
    const updated = await this.roleRepository.setStatus(roleId, "ACTIVE", input.expectedVersion);
    const affectedUsers = await this.tokenInvalidation.invalidateRoleHolders([roleId]);

    await this.auditService.record({
      action: "RBAC.ROLE_ENABLED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ROLE", id: roleId, summary: updated.key },
      outcome: "SUCCESS",
      metadata: { roleKey: updated.key, affectedUsers },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { roleId, status: "ACTIVE", affectedUsers };
  }

  /**
   * Returns a role with its permission keys.
   *
   * @param {string} roleId
   */
  async getRole(roleId) {
    const role = await this.roleRepository.assertExists(roleId);
    const keys = await this.permissionRepository.permissionKeysForRole(roleId);
    return this.toRoleDto(role, [...keys]);
  }

  /**
   * Effective permission set for a user with per-role breakdown (FR-011 §4.3).
   *
   * @param {string} userId
   */
  async getUserEffectivePermissionsDetailed(userId) {
    const user = await this.userRepository.assertExists(userId);

    const memberships = await this.userRoleRepository.findByUserId(userId);
    const roleIds = memberships.map((m) => m.roleId);
    if (roleIds.length === 0) {
      return { userId, username: user.username, roles: [], permissions: [] };
    }

    const roles = await this.roleRepository.findActiveByIds(roleIds);
    const breakdown = [];
    const union = new Set();

    for (const role of roles) {
      const keys = await this.permissionRepository.permissionKeysForRole(role.id);
      const sortedKeys = [...keys].sort();
      sortedKeys.forEach((key) => union.add(key));
      breakdown.push({ roleId: role.id, roleKey: role.key, permissions: sortedKeys });
    }

    return {
      userId,
      username: user.username,
      roles: roles.map((r) => r.key),
      permissions: [...union].sort(),
      breakdown,
    };
  }

  toRoleDto(role, permissions) {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      level: role.level ?? DEFAULT_ROLE_LEVEL,
      levelLabel: role.levelLabel ?? "",
      dataScope: role.dataScope ?? DEFAULT_ROLE_SCOPE,
      version: role.version,
      permissions: [...permissions].sort(),
    };
  }
}

/** Derives an uppercase snake key from a role name, e.g. "Payroll Specialist" → PAYROLL_SPECIALIST. */
function toRoleKey(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

/** Groups permission rows by module, applying a per-permission transform. */
function groupByModule(permissions, transform) {
  const grouped = new Map();
  for (const perm of permissions) {
    if (!grouped.has(perm.module)) grouped.set(perm.module, []);
    grouped.get(perm.module).push({
      key: perm.key,
      description: perm.description,
      grantedTo: transform(perm),
    });
  }
  return [...grouped.entries()].map(([module, list]) => ({ module, permissions: list }));
}

module.exports = { RoleAdminService, toRoleKey };
