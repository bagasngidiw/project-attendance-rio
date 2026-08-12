/**
 * Role & Permission console invariants (FR-011, design §3.4).
 *
 * These rules protect the platform from dangerous RBAC mutations:
 *  - system seed roles cannot be disabled/deleted
 *  - SUPER_ADMIN cannot lose its platform-administration permissions while it
 *    is the sole carrier of them (separation-of-duties guard)
 *  - every permission key must exist in the registry
 *  - optimistic locking prevents lost updates between admins
 */

const { validateRoleInput } = require("./model");
const { assertRegisteredPermission } = require("./permissions");
const { validateRoleLevel } = require("./role-level");
const { ValidationError, ConflictError } = require("./errors");

/** Permissions that constitute platform-administration (never removable while sole carrier). */
const PLATFORM_ADMIN_PERMISSIONS = Object.freeze([
  "rbac:manage_roles",
  "rbac:manage_permissions",
  "audit:view",
  "platform:settings",
]);

/**
 * Validates a permission key list against the registry (fail-fast).
 *
 * @param {string[]} keys
 * @returns {string[]} deduplicated, validated keys
 */
function validatePermissionKeys(keys) {
  const unique = [...new Set(keys ?? [])];
  unique.forEach(assertRegisteredPermission);
  return unique;
}

/**
 * Guards role lifecycle operations against system-role protection.
 *
 * @param {object} role role document
 * @param {'disable'|'update'} operation
 */
function assertSystemRoleAllowed(role, operation) {
  if (role.isSystem) {
    throw new ConflictError(
      `System role "${role.key}" is protected and cannot be ${operation}d.`,
      "SYSTEM_ROLE_PROTECTED"
    );
  }
}

/**
 * Guards permission-matrix edits on the SUPER_ADMIN role: platform-admin
 * permissions cannot be removed while SUPER_ADMIN remains the sole carrier.
 *
 * @param {object} role role document
 * @param {string[]} nextPermissions full post-edit permission list
 */
function assertSuperAdminPermissionsSafe(role, nextPermissions) {
  if (role.key !== "SUPER_ADMIN") return;

  const removedPlatform = PLATFORM_ADMIN_PERMISSIONS.filter(
    (key) => !nextPermissions.includes(key)
  );
  if (removedPlatform.length > 0) {
    throw new ConflictError(
      `SUPER_ADMIN cannot lose platform-administration permissions: ${removedPlatform.join(", ")}.`,
      "SUPER_ADMIN_GUARD"
    );
  }
}

/**
 * Enforces the ≥1 permission rule when creating a role.
 *
 * @param {string[]} permissions
 */
function assertRoleHasPermissions(permissions) {
  if (!permissions || permissions.length === 0) {
    throw new ValidationError(
      "A role must have at least one permission.",
      { field: "permissions" }
    );
  }
}

/**
 * Computes the permission diff for audit + persistence.
 *
 * @param {string[]} current current permission keys
 * @param {string[]} next target permission keys
 * @returns {{ added: string[], removed: string[] }}
 */
function computePermissionDiff(current, next) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((key) => !currentSet.has(key)),
    removed: [...currentSet].filter((key) => !nextSet.has(key)),
  };
}

/**
 * Validates role creation input: name/description + permission keys + the
 * FR-064 role-level attributes. The key is derived from the name and
 * normalized to an uppercase snake key.
 *
 * @param {{ key?: string, name: string, description?: string, permissions: string[], level?: number, levelLabel?: string, dataScope?: string }} input
 * @returns {{ key: string, name: string, description: string, permissions: string[], level: number, levelLabel: string, dataScope: string }}
 */
function validateRoleCreateInput({ key, name, description = "", permissions, level, levelLabel, dataScope }) {
  const normalizedKey = toRoleKey(key ?? name);
  validateRoleInput({ key: normalizedKey, name });
  assertRoleHasPermissions(permissions);
  const validatedPermissions = validatePermissionKeys(permissions);
  const validatedLevel = validateRoleLevel({ level, levelLabel, dataScope });
  return {
    key: normalizedKey,
    name: name.trim(),
    description: (description ?? "").trim(),
    permissions: validatedPermissions,
    ...validatedLevel,
  };
}

/** Derives an uppercase snake key from a role name, e.g. "Payroll Specialist" → PAYROLL_SPECIALIST. */
function toRoleKey(name) {
  return String(name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

module.exports = {
  PLATFORM_ADMIN_PERMISSIONS,
  validatePermissionKeys,
  assertSystemRoleAllowed,
  assertSuperAdminPermissionsSafe,
  assertRoleHasPermissions,
  computePermissionDiff,
  validateRoleCreateInput,
};
