/**
 * Organization domain model (FR-024).
 *
 * Department and Position entities with name validation and deactivation
 * rules. Deactivation is data-preserving (never a hard delete); historical
 * user references remain intact, but deactivated entries are excluded from
 * new-assignment pickers.
 */

const { ValidationError } = require("./errors");

const ORG_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

/** Validates and normalizes an org entry name (department/position). */
function assertOrgName(name) {
  const normalized = String(name ?? "").trim();
  if (normalized.length < 2) {
    throw new ValidationError("A name of at least 2 characters is required.", {
      field: "name",
    });
  }
  if (normalized.length > 128) {
    throw new ValidationError("Name is too long.", { field: "name" });
  }
  return normalized;
}

/** Optional code for departments (uppercase short label). */
function assertOrgCode(code) {
  if (code === undefined || code === null) return "";
  const normalized = String(code).trim().toUpperCase();
  if (normalized.length > 16) {
    throw new ValidationError("Code is too long.", { field: "code" });
  }
  return normalized;
}

/** Optional description. */
function assertDescription(description) {
  if (description === undefined || description === null) return "";
  const normalized = String(description).trim();
  if (normalized.length > 512) {
    throw new ValidationError("Description is too long.", { field: "description" });
  }
  return normalized;
}

/** A new-assignment picker must only offer ACTIVE entries. */
function isActive(entity) {
  return entity?.status === ORG_STATUS.ACTIVE;
}

/** Deactivation preserves history (no delete path). */
function isDeactivationAllowed(entity) {
  return entity?.status === ORG_STATUS.ACTIVE;
}

module.exports = {
  ORG_STATUS,
  assertOrgName,
  assertOrgCode,
  assertDescription,
  isActive,
  isDeactivationAllowed,
};
