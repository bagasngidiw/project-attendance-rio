/**
 * Permission Registry — the single source of truth for every capability
 * exposed by the platform (FR-002 / FR-027).
 *
 * Each permission is a `module:action` string. The same registry drives:
 *   - menu/navigation rendering (frontend)
 *   - action-level UI gating (frontend)
 *   - API authorization (backend boundary)
 *   - seed data (roles -> permissions)
 *
 * Future modules (payroll, recruitment, ...) register their own entries here
 * without modifying core authentication or RBAC behavior.
 */

/** @type {Readonly<Record<string, string[]>>} Grouped by module. */
const PERMISSION_REGISTRY = Object.freeze({
  DASHBOARD: ["dashboard:view"],

  PROFILE: ["profile:view", "profile:update", "mfa:manage"],

  ATTENDANCE: [
    "attendance:clock_in",
    "attendance:clock_out",
    "attendance:view_own",
    "attendance:view_all",
    "attendance:correct",
    // FR-053: managers review their direct reports' attendance exceptions.
    "attendance:review_exceptions",
  ],

  OVERTIME: [
    "overtime:submit",
    "overtime:view_own",
    "overtime:view_all",
    "overtime:review",
    "overtime:approve",
    // FR-055: HR administrative review + append-only correction of overtime records.
    "overtime:manage",
  ],

  TRIP: [
    "trip:submit",
    "trip:view_own",
    "trip:view_all",
    "trip:review",
    "trip:approve",
  ],

  LEAVE: [
    "leave:submit",
    "leave:view_own",
    "leave:view_all",
    "leave:review",
    "leave:approve",
    // FR-022: employees view their own balances; HR adjusts entitlements.
    "leave:view_balances",
    "leave:manage_balances",
  ],

  USERS: [
    "users:view",
    "users:create",
    "users:edit",
    "users:deactivate",
    "users:reset_password",
    "users:assign_roles",
    // FR-061: bulk user import (CSV/JSON).
    "users:import",
  ],

  FILES: [
    "files:upload",
    "files:download",
    "files:delete",
  ],

  CALENDAR: ["calendar:manage_holidays"],

  COMPLIANCE: [
    "compliance:manage_retention",
    "compliance:export_personal_data",
  ],

  ORG: ["org:manage_departments", "org:manage_positions"],

  REPORTING: [
    "reporting:view",
    "reporting:export_excel",
    "reporting:export_pdf",
    // FR-063/FR-064: drill-down rows and cross-status visibility.
    "reporting:drill_down",
    "reporting:view_all_statuses",
  ],

  RBAC: [
    "rbac:view_roles",
    "rbac:view_permissions",
    "rbac:manage_roles",
    "rbac:manage_permissions",
  ],

  AUDIT: ["audit:view"],

  TEAM: [
    "team:view_team",
    "team:view_pending",
    "delegation:manage",
    // FR-064 checklist-facing key for delegation (alias of delegation:manage).
    "approval:delegate",
  ],

  PLATFORM: [
    "platform:settings",
    "platform:modules",
    // FR-063: higher-level admins may override cutoff/calendar approval blocks.
    "platform:override_cutoff",
  ],

  // FR-001: Superadmin manages the approval configuration (role × request type
  // × level). Configuration controls who MAY approve, never hardcoded roles.
  APPROVAL: ["approval_config:manage"],

  // FR-007: Permission (Ijin) module — mirrors the other request modules.
  PERMISSION: [
    "permission:submit",
    "permission:view_own",
    "permission:view_all",
    "permission:review",
    "permission:approve",
  ],

  // TODO.md: Sickness (Sakit) is a separate module from Leave/Cuti.
  SAKIT: [
    "sakit:submit",
    "sakit:view_own",
    "sakit:view_all",
    "sakit:review",
    "sakit:approve",
  ],
});

/** Flat, deduplicated list of every registered permission key. */
const ALL_PERMISSIONS = Object.freeze(
  Object.values(PERMISSION_REGISTRY).flat()
);

/** A flat map from key -> { key, module, description } for seed/tooling. */
const PERMISSION_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(PERMISSION_REGISTRY).flatMap(([module, keys]) =>
      keys.map((key) => [
        key,
        {
          key,
          module,
          description: describePermission(module, key),
        },
      ])
    )
  )
);

/**
 * Human-readable description of a permission. Falls back to a generic
 * "Allows <action> in <module>" sentence when no custom text is registered.
 */
function describePermission(module, key) {
  const action = key.split(":")[1] || key;
  const actionLabel = action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return `Allows ${actionLabel} within the ${module} module.`;
}

/**
 * Validates that a permission key is registered. Throws on unknown keys so
 * typos surface at boot time (seed) and at authorization setup time.
 *
 * @param {string} key
 * @returns {string} the normalized key
 */
function assertRegisteredPermission(key) {
  if (!PERMISSION_DEFINITIONS[key]) {
    throw new Error(`Unknown permission key registered: "${key}".`);
  }
  return key;
}

/**
 * Compares a user's effective permission set against a required permission.
 * A literal match wins; the wildcard "*" grants everything.
 *
 * @param {readonly string[]} effectivePermissions
 * @param {string} requiredPermission
 * @returns {boolean}
 */
function hasPermission(effectivePermissions, requiredPermission) {
  if (effectivePermissions.includes("*")) return true;
  return effectivePermissions.includes(requiredPermission);
}

module.exports = {
  PERMISSION_REGISTRY,
  ALL_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  assertRegisteredPermission,
  hasPermission,
};
