/**
 * Audit & Activity domain model (FR-012 / FR-013).
 *
 * One capture pipeline, two surfaces:
 *  - AUDIT events   → accountability (security + administrative), tamper-resistant
 *  - ACTIVITY events → operational records of user actions
 *
 * Every event is classified once (audit, activity, or both) and carries a
 * correlation id so a single request can be traced across both surfaces.
 * Secrets (passwords, tokens, hashes) are scrubbed before anything leaves
 * the application boundary.
 */

const crypto = require("crypto");

/* ---------------------------------------------------------------------------
 * Event catalog — canonical action strings. Modules register new actions by
 * extending this list (FR-027); anything not listed here is rejected.
 * ------------------------------------------------------------------------- */

const AUDIT_EVENTS = Object.freeze([
  // Auth
  "AUTH.SIGNIN_SUCCESS",
  "AUTH.SIGNIN_FAILED",
  "AUTH.LOCKOUT",
  "AUTH.SIGNOUT",
  "AUTH.SIGNOUT_ALL",
  "AUTH.REFRESH_ROTATED",
  "AUTH.REFRESH_REUSE",
  "AUTH.DENIED",
  "AUTH.TOKEN_VERSION_BUMPED",
  "AUTH.PASSWORD_CHANGED",
  // RBAC
  "RBAC.ROLES_ASSIGNED",
  "RBAC.ROLE_CREATED",
  "RBAC.ROLE_UPDATED",
  "RBAC.ROLE_DISABLED",
  "RBAC.ROLE_ENABLED",
  "RBAC.PERMISSION_CHANGED",
  // User lifecycle
  "USER.CREATED",
  "USER.UPDATED",
  "USER.DEACTIVATED",
  "USER.ACTIVATED",
  "USER.PASSWORD_RESET",
  // Requests / workflows
  "LEAVE.SUBMITTED",
  "OVERTIME.SUBMITTED",
  "TRIP.SUBMITTED",
  "PERMISSION.SUBMITTED",
  "SAKIT.SUBMITTED",
  "REQUEST.APPROVED",
  "REQUEST.REJECTED",
  "REQUEST.CANCELLED",
  "REQUEST.EDITED",
  // Data
  "ATTENDANCE.CORRECTED",
  "PROFILE.UPDATED",
  "REPORT.EXPORTED",
  // Platform
  "MODULE.ENABLED",
  "MODULE.DISABLED",
  "SETTINGS.CHANGED",
  // Organization (FR-024 / FR-043)
  "ORG.DEPARTMENT_CREATED",
  "ORG.DEPARTMENT_UPDATED",
  "ORG.DEPARTMENT_DEACTIVATED",
  "ORG.DEPARTMENT_ACTIVATED",
  "ORG.POSITION_CREATED",
  "ORG.POSITION_UPDATED",
  "ORG.POSITION_DEACTIVATED",
  "ORG.POSITION_ACTIVATED",
  "REPORTING.MANAGER_ASSIGNED",
  // Delegation & escalation (FR-009)
  "DELEGATION.CREATED",
  "DELEGATION.REVOKED",
  "ESCALATION.TRIGGERED",
  // Attendance & overtime administration (FR-053 / FR-055)
  "ATTENDANCE.EXCEPTION_REVIEWED",
  "OVERTIME.CORRECTED",
  "ATTENDANCE.MEDIA_UPLOADED",
  "ATTENDANCE.MEDIA_VIEWED",
  // Attendance media (TODO.md FR-008/FR-013)
  "ATTENDANCE.MEDIA_UPLOADED",
  "ATTENDANCE.MEDIA_VIEWED",
  // Leave balances & calendar (FR-022 / FR-059 / TODO.md FR-003)
  "LEAVE.BALANCE_ADJUSTED",
  "LEAVE.QUOTA_ADJUSTED",
  "CALENDAR.HOLIDAY_CREATED",
  "CALENDAR.HOLIDAY_UPDATED",
  "CALENDAR.HOLIDAY_DEACTIVATED",
  "CALENDAR.HOLIDAY_ACTIVATED",
  // Files (FR-017)
  "FILE.UPLOADED",
  "FILE.DOWNLOADED",
  "FILE.DELETED",
  // Filter presets (FR-047)
  "FILTER_PRESET.CREATED",
  "FILTER_PRESET.UPDATED",
  "FILTER_PRESET.DELETED",
  // Compliance (FR-040 / FR-048)
  "RETENTION.POLICY_CHANGED",
  "RETENTION.SWEEP_RAN",
  "PERSONAL_DATA.EXPORTED",
  // Recovery & bulk import (FR-045 / FR-061)
  "AUTH.RECOVERY_REQUESTED",
  "AUTH.PASSWORD_RECOVERED",
  "USERS.IMPORTED",
  // MFA (FR-051)
  "MFA.ENROLLED",
  "MFA.DISABLED",
  "MFA.CHALLENGE_PASSED",
  "MFA.CHALLENGE_FAILED",
  // Data scope enforcement (FR-056)
  "SCOPE.DENIED",
  // Unified approval workflow (FR-063)
  "REQUEST.ESCALATED",
  "APPROVAL.OVERRIDE",
  "APPROVAL.DELEGATED",
  // Role levels & scope changes (FR-064)
  "RBAC.ROLE_LEVEL_CHANGED",
  // Approval workflow revamp (FR-001/FR-002/FR-009)
  "APPROVAL_CONFIG_UPDATED",
  "REQUEST.ASSIGNED",
  "REQUEST.CLAIMED",
]);

/** Activity-only events (operational surface, FR-013): sensitive-record views. */
const ACTIVITY_ONLY_EVENTS = Object.freeze([
  "PROFILE.VIEWED",
  "ATTENDANCE.VIEWED",
  "ATTENDANCE.CLOCKED_IN",
  "ATTENDANCE.CLOCKED_OUT",
  "REPORT.VIEWED",
  "USER.VIEWED",
  "TEAM.VIEWED",
]);

/** All event actions (audit ∪ activity-only). */
const ALL_EVENTS = Object.freeze([
  ...AUDIT_EVENTS,
  ...ACTIVITY_ONLY_EVENTS,
]);

/** Actions that must land in BOTH surfaces. */
const BOTH_SURFACES = Object.freeze([
  "RBAC.ROLES_ASSIGNED",
  "RBAC.ROLE_CREATED",
  "RBAC.ROLE_UPDATED",
  "RBAC.ROLE_DISABLED",
  "RBAC.ROLE_ENABLED",
  "RBAC.PERMISSION_CHANGED",
  "USER.CREATED",
  "USER.UPDATED",
  "USER.DEACTIVATED",
  "USER.ACTIVATED",
  "USER.PASSWORD_RESET",
  "LEAVE.SUBMITTED",
  "OVERTIME.SUBMITTED",
  "TRIP.SUBMITTED",
  "PERMISSION.SUBMITTED",
  "SAKIT.SUBMITTED",
  "REQUEST.APPROVED",
  "REQUEST.REJECTED",
  "REQUEST.CANCELLED",
  "REQUEST.EDITED",
  "ATTENDANCE.CORRECTED",
  "PROFILE.UPDATED",
  "REPORT.EXPORTED",
  "MODULE.ENABLED",
  "MODULE.DISABLED",
  "SETTINGS.CHANGED",
  "AUTH.PASSWORD_CHANGED",
  "ORG.DEPARTMENT_CREATED",
  "ORG.DEPARTMENT_UPDATED",
  "ORG.DEPARTMENT_DEACTIVATED",
  "ORG.DEPARTMENT_ACTIVATED",
  "ORG.POSITION_CREATED",
  "ORG.POSITION_UPDATED",
  "ORG.POSITION_DEACTIVATED",
  "ORG.POSITION_ACTIVATED",
  "REPORTING.MANAGER_ASSIGNED",
  "DELEGATION.CREATED",
  "DELEGATION.REVOKED",
  "ESCALATION.TRIGGERED",
  "ATTENDANCE.EXCEPTION_REVIEWED",
  "OVERTIME.CORRECTED",
  "ATTENDANCE.MEDIA_UPLOADED",
  "ATTENDANCE.MEDIA_VIEWED",
  "LEAVE.BALANCE_ADJUSTED",
  "LEAVE.QUOTA_ADJUSTED",
  "CALENDAR.HOLIDAY_CREATED",
  "CALENDAR.HOLIDAY_UPDATED",
  "CALENDAR.HOLIDAY_DEACTIVATED",
  "CALENDAR.HOLIDAY_ACTIVATED",
  "FILE.UPLOADED",
  "FILE.DOWNLOADED",
  "FILE.DELETED",
  "FILTER_PRESET.CREATED",
  "FILTER_PRESET.UPDATED",
  "FILTER_PRESET.DELETED",
  "RETENTION.POLICY_CHANGED",
  "RETENTION.SWEEP_RAN",
  "PERSONAL_DATA.EXPORTED",
  "AUTH.RECOVERY_REQUESTED",
  "AUTH.PASSWORD_RECOVERED",
  "USERS.IMPORTED",
  "MFA.ENROLLED",
  "MFA.DISABLED",
  "MFA.CHALLENGE_PASSED",
  "MFA.CHALLENGE_FAILED",
  "SCOPE.DENIED",
  "REQUEST.ESCALATED",
  "APPROVAL.OVERRIDE",
  "APPROVAL.DELEGATED",
  "RBAC.ROLE_LEVEL_CHANGED",
  "APPROVAL_CONFIG_UPDATED",
  "REQUEST.ASSIGNED",
  "REQUEST.CLAIMED",
]);

const EVENT_SET = new Set(ALL_EVENTS);

/** Throws when an action is not registered (fail-fast). */
function assertRegisteredEvent(action) {
  if (!EVENT_SET.has(action)) {
    throw new Error(`Unknown audit/activity event action: "${action}".`);
  }
  return action;
}

/**
 * Classifies an action into the surfaces it must be written to.
 *
 * @param {string} action
 * @returns {{ audit: boolean, activity: boolean }}
 */
function classifyEvent(action) {
  assertRegisteredEvent(action);
  const audit = AUDIT_EVENTS.includes(action);
  const activity =
    ACTIVITY_ONLY_EVENTS.includes(action) || BOTH_SURFACES.includes(action);
  return { audit, activity };
}

/* ---------------------------------------------------------------------------
 * Secret scrubbing — metadata keys that must never be persisted.
 * ------------------------------------------------------------------------- */

const SECRET_KEYS = Object.freeze([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "refreshTokenHash",
  "secret",
  "newPassword",
  "oldPassword",
]);

/** Returns a new metadata object with any secret-bearing keys removed. */
function scrubMetadata(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const scrubbed = {};
  for (const [key, value] of Object.entries(source)) {
    const keyLower = key.toLowerCase().replace(/_/g, "");
    const isSecret = SECRET_KEYS.some(
      (secret) => keyLower === secret || keyLower.endsWith(secret.toLowerCase())
    );
    if (!isSecret) scrubbed[key] = value;
  }
  return scrubbed;
}

/* ---------------------------------------------------------------------------
 * Correlation ids + event hashing (tamper-evidence, design §3.1/§4.1).
 * ------------------------------------------------------------------------- */

/** Generates a correlation id for request tracing. */
function generateCorrelationId() {
  return `corr_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Computes the SHA-256 hash of an audit event over a canonical payload,
 * including a server-side salt so the chain cannot be re-forged from the
 * database alone.
 *
 * @param {object} input
 * @param {string} input.prevHash hash of the previous event in the chain
 * @param {string} input.action
 * @param {string} input.actorUserId
 * @param {string} [input.subjectId]
 * @param {string} input.outcome
 * @param {string} input.recordedAt ISO timestamp
 * @param {string} input.salt server-side chain salt
 */
function computeEventHash({
  prevHash = "",
  action,
  actorUserId = "",
  subjectId = "",
  outcome = "",
  recordedAt,
  salt,
}) {
  const canonical = [
    prevHash,
    action,
    actorUserId,
    subjectId,
    outcome,
    recordedAt,
    salt,
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = {
  AUDIT_EVENTS,
  ACTIVITY_ONLY_EVENTS,
  BOTH_SURFACES,
  assertRegisteredEvent,
  classifyEvent,
  scrubMetadata,
  SECRET_KEYS,
  generateCorrelationId,
  computeEventHash,
};
