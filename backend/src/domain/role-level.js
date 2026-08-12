/**
 * Role-level domain model (FR-064).
 *
 * A role level is a numeric ordering attribute (higher = broader authority)
 * with an optional human label. Level groups authority/visibility/escalation/
 * reporting scope and feeds default suggestions in the RBAC console — but a
 * level NEVER creates approval chains (FR-063) and NEVER grants data access
 * by itself: explicit permissions + the role's explicit `dataScope` govern.
 */

const ROLE_DATA_SCOPES = Object.freeze([
  "SELF",
  "DIRECT_SUBORDINATES",
  "DIRECT_AND_INDIRECT_SUBORDINATES",
  "DEPARTMENT",
  "ALL_EMPLOYEES",
]);

/** Direction constant: higher numeric level = higher authority. */
const LEVEL_DIRECTION = "HIGHER_IS_HIGHER";

/** Default level + scope used when a role does not specify them. */
const DEFAULT_ROLE_LEVEL = 10;
const DEFAULT_ROLE_SCOPE = "SELF";

/** Suggested default scope per level band (suggestion only, never enforced). */
const LEVEL_SCOPE_SUGGESTIONS = Object.freeze([
  { minLevel: 1, maxLevel: 19, scope: "SELF" },
  { minLevel: 20, maxLevel: 59, scope: "DIRECT_SUBORDINATES" },
  { minLevel: 60, maxLevel: 89, scope: "DEPARTMENT" },
  { minLevel: 90, maxLevel: 1000, scope: "ALL_EMPLOYEES" },
]);

/**
 * True when `a` outranks `b` (higher numeric value). Uses a constant so the
 * direction is explicit and configurable.
 *
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function isHigherLevel(a, b) {
  if (LEVEL_DIRECTION === "HIGHER_IS_HIGHER") return a > b;
  return a < b;
}

/**
 * Suggests a default data scope for a level (console convenience only).
 *
 * @param {number} level
 * @returns {string}
 */
function defaultScopeForLevel(level) {
  const match = LEVEL_SCOPE_SUGGESTIONS.find(
    (band) => level >= band.minLevel && level <= band.maxLevel
  );
  return match?.scope ?? DEFAULT_ROLE_SCOPE;
}

/**
 * Validates a role-level input (FR-064 V1).
 *
 * @param {{ level?: number, levelLabel?: string, dataScope?: string }} input
 * @returns {{ level: number, levelLabel: string, dataScope: string }}
 * @throws {ValidationError}
 */
function validateRoleLevel({ level = DEFAULT_ROLE_LEVEL, levelLabel = "", dataScope = DEFAULT_ROLE_SCOPE } = {}) {
  const { ValidationError } = require("./errors");

  if (!Number.isInteger(level) || level < 1 || level > 1000) {
    throw new ValidationError("Role level must be an integer between 1 and 1000.", {
      field: "level",
    });
  }
  if (typeof levelLabel !== "string" || levelLabel.length > 64) {
    throw new ValidationError("Role level label must be a string of at most 64 characters.", {
      field: "levelLabel",
    });
  }
  if (!ROLE_DATA_SCOPES.includes(dataScope)) {
    throw new ValidationError(
      `Data scope must be one of ${ROLE_DATA_SCOPES.join(", ")}.`,
      { field: "dataScope" }
    );
  }
  return {
    level,
    levelLabel: levelLabel.trim(),
    dataScope,
  };
}

module.exports = {
  ROLE_DATA_SCOPES,
  LEVEL_DIRECTION,
  DEFAULT_ROLE_LEVEL,
  DEFAULT_ROLE_SCOPE,
  LEVEL_SCOPE_SUGGESTIONS,
  isHigherLevel,
  defaultScopeForLevel,
  validateRoleLevel,
};
