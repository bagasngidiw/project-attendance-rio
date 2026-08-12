/**
 * Data-scope domain model (FR-056) — resolves the maximum record visibility a
 * principal may exercise and answers "can this principal access that record?"
 *
 * Scopes are strictly ordered: SELF < TEAM < COMPANY.
 *
 * Resolution is permission-driven (never role-name-driven):
 *   - a `*:view_all` permission (attendance/overtime/trip/leave) or any
 *     company-wide administrative permission implies COMPANY;
 *   - `team:view_team` / `team:view_pending` implies TEAM;
 *   - otherwise the principal is SELF-scoped.
 *
 * The SUPER_ADMIN wildcard `*` always resolves to COMPANY.
 */

const DATA_SCOPES = Object.freeze({
  SELF: "SELF",
  TEAM: "TEAM",
  COMPANY: "COMPANY",
});

const SCOPE_RANK = Object.freeze({
  SELF: 0,
  TEAM: 1,
  COMPANY: 2,
});

/** Permissions that grant company-wide visibility. */
const COMPANY_VIEW_PERMISSIONS = new Set([
  "attendance:view_all",
  "overtime:view_all",
  "trip:view_all",
  "leave:view_all",
  "users:view",
  "audit:view",
  "reporting:view",
  "rbac:view_roles",
  "rbac:view_permissions",
  "platform:settings",
]);

/** Permissions that grant team-wide visibility. */
const TEAM_VIEW_PERMISSIONS = new Set([
  "team:view_team",
  "team:view_pending",
]);

/**
 * Resolves the maximum data scope a principal may access.
 *
 * @param {object} input
 * @param {readonly string[]} [input.permissions] effective permission keys
 * @param {readonly string[]} [input.roles] role keys (for SUPER_ADMIN wildcard)
 * @returns {keyof typeof DATA_SCOPES}
 */
function resolveScope({ permissions = [], roles = [] } = {}) {
  if (roles.includes("SUPER_ADMIN")) return DATA_SCOPES.COMPANY;
  if (permissions.includes("*")) return DATA_SCOPES.COMPANY;
  if (permissions.some((key) => COMPANY_VIEW_PERMISSIONS.has(key))) {
    return DATA_SCOPES.COMPANY;
  }
  if (permissions.some((key) => TEAM_VIEW_PERMISSIONS.has(key))) {
    return DATA_SCOPES.TEAM;
  }
  return DATA_SCOPES.SELF;
}

/**
 * True when `scope` satisfies (is at least as wide as) `minimum`.
 *
 * @param {keyof typeof DATA_SCOPES} scope
 * @param {keyof typeof DATA_SCOPES} minimum
 * @returns {boolean}
 */
function scopeSatisfies(scope, minimum) {
  return SCOPE_RANK[scope] >= SCOPE_RANK[minimum];
}

/**
 * True when the principal may access `targetUser`'s records.
 *
 * COMPANY scope grants everything; TEAM scope grants direct reports and
 * self; SELF scope grants only the principal themselves.
 *
 * @param {object} principal resolved principal (id, dataScope)
 * @param {object} targetUser target user document
 * @returns {boolean}
 */
function canAccessTarget(principal, targetUser) {
  if (!targetUser) return false;
  if (principal.dataScope === DATA_SCOPES.COMPANY) return true;
  if (principal.dataScope === DATA_SCOPES.TEAM) {
    const isSelf = String(targetUser.id) === String(principal.userId);
    const isDirectReport =
      targetUser.managerId != null &&
      String(targetUser.managerId) === String(principal.userId);
    return isSelf || isDirectReport;
  }
  return String(targetUser.id) === String(principal.userId);
}

module.exports = {
  DATA_SCOPES,
  SCOPE_RANK,
  resolveScope,
  scopeSatisfies,
  canAccessTarget,
};
