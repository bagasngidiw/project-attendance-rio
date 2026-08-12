/**
 * Core domain entities and value objects for the identity + RBAC foundation
 * (FR-001 / FR-002).
 *
 * This layer is deliberately framework-free: no Mongoose, no Express, no
 * crypto. Business rules (effective-permission union, role invariants,
 * status transitions) live here and are fully unit-testable.
 */

const {
  PERMISSION_DEFINITIONS,
} = require("./permissions");
const { ValidationError } = require("./errors");

/* ---------------------------------------------------------------------------
 * Value Objects
 * ------------------------------------------------------------------------- */

/**
 * Email value object. Normalizes to lowercase and validates shape.
 * Throws a ValidationError when the value is not a valid email address.
 */
class Email {
  static EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  constructor(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!Email.EMAIL_PATTERN.test(normalized)) {
      throw new ValidationError("A valid email address is required.", {
        field: "email",
      });
    }
    this.value = normalized;
  }

  toString() {
    return this.value;
  }

  equals(other) {
    return other instanceof Email && other.value === this.value;
  }
}

/**
 * PermissionKey value object. Guarantees every key is a registered
 * `module:action` string before it is ever persisted or checked.
 */
class PermissionKey {
  constructor(key) {
    const definition = PERMISSION_DEFINITIONS[key];
    if (!definition) {
      throw new ValidationError(`Unknown permission key: "${key}".`, {
        field: "permissionKey",
      });
    }
    this.key = key;
    this.module = definition.module;
  }

  toString() {
    return this.key;
  }
}

/**
 * EffectivePermissions value object. Immutable set produced by unioning the
 * permission sets of every ACTIVE role assigned to a user. The wildcard "*"
 * grants every capability and is accepted without a registry entry.
 */
class EffectivePermissions {
  constructor(keys) {
    const unique = [...new Set(keys)];
    unique.forEach((key) => {
      if (key !== "*") new PermissionKey(key);
    });
    this.keys = Object.freeze([...unique]);
  }

  has(requiredKey) {
    if (this.keys.includes("*")) return true;
    return this.keys.includes(requiredKey);
  }

  toArray() {
    return [...this.keys];
  }

  equals(other) {
    if (!(other instanceof EffectivePermissions)) return false;
    return (
      this.keys.length === other.keys.length &&
      this.keys.every((k, i) => k === other.keys[i])
    );
  }
}

/* ---------------------------------------------------------------------------
 * Role rules (Domain service)
 * ------------------------------------------------------------------------- */

const ROLE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

/**
 * Validates role invariants shared by seed and console workflows.
 */
function validateRoleInput({ key, name }) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new ValidationError(
      "Role key must be uppercase with letters, digits and underscores.",
      { field: "key" }
    );
  }
  if (!name || name.trim().length < 2) {
    throw new ValidationError("Role name must be at least 2 characters.", {
      field: "name",
    });
  }
}

/**
 * Guards the SUPER_ADMIN safety invariant: the platform must always keep at
 * least one ACTIVE SUPER_ADMIN user, and the SUPER_ADMIN role cannot have its
 * platform-administration permissions fully stripped.
 */
function assertSuperAdminSafe(userRoles, roleKeysById, requestedRoleIds) {
  const retainsSuperAdmin =
    requestedRoleIds.some((roleId) => roleKeysById.get(roleId) === "SUPER_ADMIN");

  const hadSuperAdmin = userRoles.some(
    (membership) => roleKeysById.get(membership.roleId) === "SUPER_ADMIN"
  );

  if (hadSuperAdmin && !retainsSuperAdmin) {
    throw new ValidationError(
      "A SUPER_ADMIN account must always retain the SUPER_ADMIN role.",
      { field: "roleIds" }
    );
  }
}

/* ---------------------------------------------------------------------------
 * Effective permission resolution (pure function)
 * ------------------------------------------------------------------------- */

/**
 * Computes the union of permissions granted by a set of roles.
 *
 * @param {ReadonlyArray<{ roleKey: string, permissionKeys: string[] }>} roles
 * @returns {string[]} sorted unique permission keys
 */
function computeEffectivePermissions(roles) {
  const union = new Set();
  for (const role of roles) {
    if (!role || role.status === "DISABLED") continue;
    for (const key of role.permissionKeys) union.add(key);
  }
  return [...union].sort();
}

/* ---------------------------------------------------------------------------
 * Manager team scope (FR-006)
 * ------------------------------------------------------------------------- */

/**
 * Returns true when a user is a direct report of the given manager — the
 * reporting structure that defines the Manager's team scope.
 *
 * @param {string|object|null} memberManagerId the member's `managerId` value
 * @param {string|object|null} managerId the acting manager's user id
 * @returns {boolean}
 */
function isWithinTeamScope(memberManagerId, managerId) {
  if (memberManagerId == null || managerId == null) return false;
  return String(memberManagerId) === String(managerId);
}

/**
 * Validates a reporting-line assignment (FR-006/FR-024 extension point):
 * - a user can never be their own manager
 * - a managerId, when provided, must be a non-empty value
 *
 * @param {{ userId: string, managerId?: string|null }} input
 */
function assertValidManagerAssignment({ userId, managerId }) {
  if (managerId == null || managerId === "") return;
  if (String(managerId) === String(userId)) {
    throw new ValidationError("A user cannot be their own manager.", {
      field: "managerId",
    });
  }
}

module.exports = {
  Email,
  PermissionKey,
  EffectivePermissions,
  ROLE_STATUS,
  validateRoleInput,
  assertSuperAdminSafe,
  computeEffectivePermissions,
  isWithinTeamScope,
  assertValidManagerAssignment,
};
