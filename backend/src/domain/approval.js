/**
 * Approval domain value object (FR-002) — the shared approval semantics for
 * Overtime, Business Trip, Leave and Permission.
 *
 * Pure: statuses, target invariants, claiming invariant and the mandatory
 * rejection-reason rule. The application engine performs the I/O-heavy
 * eligibility resolution (FR-001/FR-003) and the atomic persistence (FR-010).
 */

const { ValidationError, ConflictError } = require("./errors");

const APPROVAL_TARGET_TYPES = Object.freeze({
  ROLE: "ROLE",
  USER: "USER",
});

/** Statuses the approval portion may take (mirrors agents.md §10). */
const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

/**
 * Validates the target shape at submission (agents.md §13).
 *
 * @param {{ targetType?: string, targetRoleId?: string|null, targetUserId?: string|null }} input
 * @throws {ValidationError}
 */
function assertTargetShape(input = {}) {
  if (!APPROVAL_TARGET_TYPES[input.targetType]) {
    throw new ValidationError(
      `approvalTarget.targetType must be ROLE or USER.`,
      { field: "approvalTarget.targetType" }
    );
  }
  if (input.targetType === APPROVAL_TARGET_TYPES.ROLE) {
    if (!input.targetRoleId) {
      throw new ValidationError(
        "approvalTarget.targetRoleId is required when targeting a role.",
        { field: "approvalTarget.targetRoleId" }
      );
    }
  } else if (!input.targetUserId) {
    throw new ValidationError(
      "approvalTarget.targetUserId is required when targeting a user.",
      { field: "approvalTarget.targetUserId" }
    );
  }
}

/**
 * A role-targeted request is claimable only while it is pending and no one has
 * claimed it yet (agents.md §15).
 *
 * @param {object} approval the request.approval subdocument
 * @param {string} internalStatus the request's internal status (PENDING)
 */
function canClaim(approval, internalStatus) {
  return (
    approval?.targetType === APPROVAL_TARGET_TYPES.ROLE &&
    approval?.assignedUserId == null &&
    internalStatus === "PENDING"
  );
}

/**
 * Rejection reason is MANDATORY (agents.md §16/§29 — overrides FR-063's
 * optional behavior per the blueprint).
 *
 * @param {string|null|undefined} reason
 */
function assertRejectionReason(reason) {
  if (!reason || !String(reason).trim()) {
    throw new ValidationError("A rejection reason is required.", {
      field: "rejectionReason",
    });
  }
}

/**
 * No self-approval unless the configuration explicitly allows it (default
 * false, agents.md §29).
 *
 * @param {string} requesterId
 * @param {string} actorId
 * @param {boolean} selfApprovalAllowed
 */
function assertNoSelfApprovalUnlessAllowed(requesterId, actorId, selfApprovalAllowed = false) {
  if (!selfApprovalAllowed && actorId && String(actorId) === String(requesterId)) {
    throw new ConflictError(
      "You cannot approve or reject your own request.",
      "SELF_APPROVAL_DENIED"
    );
  }
}

module.exports = {
  APPROVAL_TARGET_TYPES,
  APPROVAL_STATUS,
  assertTargetShape,
  canClaim,
  assertRejectionReason,
  assertNoSelfApprovalUnlessAllowed,
};
