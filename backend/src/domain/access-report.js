/**
 * access-report.js — pure report helpers for the access-collections inspector
 * (`scripts/show-access-collections.js`).
 *
 * This module is framework-free: it performs no I/O, imports no Mongoose and
 * no repositories. It transforms already-loaded data into report rows.
 *
 * Security contract: `sanitizeUser` is the single guard that strips password
 * and token bookkeeping fields. Every user-shaped output in the report MUST go
 * through `sanitizeUser` so secrets are never printed.
 */

/**
 * Returns a sanitized, serializable user row.
 *
 * Never includes: passwordHash, passwordHistory, passwordVersion,
 * passwordChangedAt, failedLoginAttempts, lockedUntil, tokenVersion, __v.
 *
 * @param {object} user — a Mongoose document or lean row (may carry _id)
 * @returns {{ id: string, username: string, name: string, email: string, status: string, roleIds: string[] }}
 */
function sanitizeUser(user) {
  return {
    id: String(user._id ?? user.id),
    username: user.username,
    name: user.name,
    email: user.email,
    status: user.status,
    roleIds: (user.roleIds ?? []).map(String),
  };
}

/**
 * Builds a role report row with its granted permission keys.
 *
 * @param {object} role — role document
 * @param {Iterable<string>} permissionKeys — e.g. Set or array
 * @returns {{ key: string, name: string, level: number, levelLabel: string, dataScope: string, status: string, permissions: string[] }}
 */
function roleRow(role, permissionKeys) {
  return {
    key: role.key,
    name: role.name,
    level: role.level,
    levelLabel: role.levelLabel ?? "",
    dataScope: role.dataScope,
    status: role.status,
    permissions: [...permissionKeys].sort(),
  };
}

/**
 * Builds a user report row with resolved role keys.
 *
 * @param {object} user — sanitized user row (see `sanitizeUser`)
 * @param {Map<string, string>} roleKeysById — roleId-string → role key
 * @returns {{ username: string, name: string, email: string, status: string, roles: string[] }}
 */
function userRow(user, roleKeysById) {
  const roles = (user.roleIds ?? [])
    .map((id) => roleKeysById.get(String(id)))
    .filter(Boolean)
    .sort();
  return {
    username: user.username,
    name: user.name,
    email: user.email,
    status: user.status,
    roles,
  };
}

/**
 * Builds the navigation/menu tree visible to the given permission set.
 *
 * Delegates to the existing (pure, no-I/O) `buildNavigationFor` from the
 * application layer so the inspector reuses the exact same menu logic as the
 * running application — never a duplicate implementation.
 *
 * The import is lazy so the top of this module stays free of cross-layer
 * requires and the unit tests can load this module without side effects.
 *
 * @param {readonly string[]} permissionKeys
 * @returns {Array<object>} filtered navigation tree
 */
function buildMenuTree(permissionKeys) {
  const { buildNavigationFor } = require("../application/navigation.service");
  return buildNavigationFor(permissionKeys);
}

module.exports = { sanitizeUser, roleRow, userRow, buildMenuTree };
