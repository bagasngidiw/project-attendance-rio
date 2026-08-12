/**
 * Retention domain model (FR-040).
 *
 * Pure functions describing the data-retention policy: defaults, normalization
 * (merge + validation), and per-record expiry evaluation that honours legal
 * holds and "keep forever" (null) categories.
 */

const { ValidationError } = require("./errors");

/** All retention categories keyed by the number of days to retain. */
const RETENTION_CATEGORIES = Object.freeze([
  "auditEventsDays",
  "activityLogsDays",
  "attachmentsDays",
  "requestsDays",
  "usersDays",
]);

/** Default policy — users are retained forever (null = never expires). */
const DEFAULT_RETENTION_POLICY = Object.freeze({
  auditEventsDays: 730,
  activityLogsDays: 365,
  attachmentsDays: 1825,
  requestsDays: 2555,
  usersDays: null,
  legalHold: [],
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Merges a raw policy over the defaults and validates every category.
 * A retention day count must be a non-negative integer or null (keep forever);
 * legalHold is an array of { type, id } references.
 *
 * @param {object|null} raw
 * @returns {object} normalized policy
 */
function normalizeRetentionPolicy(raw = {}) {
  if (raw === null || raw === undefined) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Retention policy must be an object.", { field: "policy" });
  }

  const policy = { ...DEFAULT_RETENTION_POLICY };
  for (const key of RETENTION_CATEGORIES) {
    if (raw[key] !== undefined) policy[key] = raw[key];
    validateDays(key, policy[key]);
  }

  policy.legalHold = normalizeLegalHold(raw.legalHold);
  return policy;
}

function validateDays(key, value) {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(
      `${key} must be a non-negative integer or null (keep forever).`,
      { field: key }
    );
  }
}

function normalizeLegalHold(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError("legalHold must be an array.", { field: "legalHold" });
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError(
        `legalHold[${index}] must be an object with type and id.`,
        { field: "legalHold" }
      );
    }
    if (typeof entry.type !== "string" || entry.type.length === 0) {
      throw new ValidationError(
        `legalHold[${index}] requires a non-empty type.`,
        { field: "legalHold" }
      );
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new ValidationError(
        `legalHold[${index}] requires a non-empty id.`,
        { field: "legalHold" }
      );
    }
    return { type: entry.type, id: entry.id };
  });
}

/**
 * Evaluates whether a record has outlived its retention window.
 *
 * A record never expires when it is on legal hold or when the category
 * retention is null (keep forever). `now` is injectable for tests.
 *
 * @param {{ recordedAt: Date|string, retentionDays: number|null, onLegalHold?: boolean, now?: Date }} input
 * @returns {boolean}
 */
function isExpired({ recordedAt, retentionDays, onLegalHold = false, now = new Date() }) {
  if (onLegalHold) return false;
  if (retentionDays === null || retentionDays === undefined) return false;
  const date = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  return date.getTime() < cutoff.getTime();
}

module.exports = {
  RETENTION_CATEGORIES,
  DEFAULT_RETENTION_POLICY,
  DAY_MS,
  normalizeRetentionPolicy,
  isExpired,
};
