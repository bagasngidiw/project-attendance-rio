/**
 * Approval configuration domain model (FR-001).
 *
 * One configuration document per request type (LEAVE | OVERTIME | TRIP |
 * PERMISSION) defines WHICH roles may approve, at WHAT numeric level, and
 * whether each role is enabled and selectable as an approval target. Roles
 * come from the existing RBAC `roles` collection — never hardcoded names.
 *
 * Levels are numeric seniority (0 = cannot approve; higher = more senior).
 * The Superadmin controls the configuration; the engine re-resolves
 * eligibility server-side at submission and at decision time.
 *
 * Pure: no I/O. The application layer supplies role/user lookups.
 */

const { ValidationError } = require("./errors");

/** Request types the approval workflow covers (agents.md §1). */
const CONFIG_REQUEST_TYPES = Object.freeze([
  "LEAVE",
  "OVERTIME",
  "TRIP",
  "PERMISSION",
  "SAKIT",
]);

/** Default configuration: every role disabled, self-approval off. */
function defaultConfiguration(requestType) {
  return {
    requestType,
    roles: [],
    selfApproval: false,
    version: 1,
  };
}

/**
 * Validates + normalizes an approval configuration payload.
 *
 * @param {{ requestType: string, roles?: Array<{ roleId: string, approvalLevel: number, canApprove?: boolean, canBeTarget?: boolean }>, selfApproval?: boolean }} input
 * @returns normalized configuration
 * @throws {ValidationError}
 */
function validateConfiguration(input) {
  if (!CONFIG_REQUEST_TYPES.includes(input.requestType)) {
    throw new ValidationError(
      `requestType must be one of ${CONFIG_REQUEST_TYPES.join(", ")}.`,
      { field: "requestType" }
    );
  }

  const roles = Array.isArray(input.roles) ? input.roles : [];
  const seen = new Set();
  const normalizedRoles = roles.map((entry) => {
    if (!entry || !entry.roleId) {
      throw new ValidationError("Each role entry requires a roleId.", {
        field: "roles",
      });
    }
    const roleId = String(entry.roleId);
    if (seen.has(roleId)) {
      throw new ValidationError("A role cannot be configured twice.", {
        field: "roles",
      });
    }
    seen.add(roleId);
    const approvalLevel = Number(entry.approvalLevel);
    if (!Number.isInteger(approvalLevel) || approvalLevel < 0) {
      throw new ValidationError(
        "Approval level must be a non-negative integer.",
        { field: "roles" }
      );
    }
    const canApprove = entry.canApprove === true && approvalLevel > 0;
    return {
      roleId,
      approvalLevel,
      canApprove,
      canBeTarget: entry.canBeTarget === true && canApprove,
    };
  });

  return {
    requestType: input.requestType,
    roles: normalizedRoles,
    selfApproval: input.selfApproval === true,
  };
}

/** True when a configured role entry may approve. */
function canApproveEntry(entry) {
  return Boolean(entry?.canApprove) && Number(entry?.approvalLevel) > 0;
}

/** True when a configured role entry may be selected as a target. */
function canBeTargetEntry(entry) {
  return canApproveEntry(entry) && entry?.canBeTarget === true;
}

/**
 * Builds the immutable configuration snapshot stored on every submitted
 * request (agents.md §14) so historical decisions stay auditable even after
 * the live configuration changes.
 *
 * @param {object} params
 * @param {string} params.requestType
 * @param {"ROLE"|"USER"} params.targetType
 * @param {string|null} params.targetRoleId
 * @param {string|null} params.targetUserId
 * @param {string|null} params.targetRoleName
 * @param {number|null} params.targetRoleLevel
 * @param {string|null} params.targetUserName
 */
function buildSnapshot({
  requestType,
  targetType,
  targetRoleId = null,
  targetUserId = null,
  targetRoleName = null,
  targetRoleLevel = null,
  targetUserName = null,
}) {
  return {
    requestType,
    targetType,
    targetRoleId: targetRoleId ? String(targetRoleId) : null,
    targetRoleName,
    targetRoleLevel,
    targetUserId: targetUserId ? String(targetUserId) : null,
    targetUserName,
  };
}

module.exports = {
  CONFIG_REQUEST_TYPES,
  defaultConfiguration,
  validateConfiguration,
  canApproveEntry,
  canBeTargetEntry,
  buildSnapshot,
};
