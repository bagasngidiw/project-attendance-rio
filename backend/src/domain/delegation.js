/**
 * Delegation domain model (FR-009).
 *
 * Pure, dependency-free rules for approval delegation: an approver (delegator)
 * grants another user (delegate) the power to decide requests of the given
 * types within a date window. Empty requestTypes means "all types".
 */

const { ValidationError } = require("./errors");

const DELEGATION_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
});

/** Request types a delegation may cover (lower-case canonical form). */
const ALLOWED_REQUEST_TYPES = Object.freeze(["leave", "overtime", "trip"]);

/**
 * Validates a delegation draft and returns the normalized shape ready for
 * persistence (dates coerced to Date, requestTypes normalized to lower-case).
 *
 * @param {{ delegatorId: string, delegateId: string, requestTypes?: string[], startsAt: string|Date, endsAt: string|Date }} input
 * @param {{ isSamePerson?: boolean, delegateIsActive?: boolean }} context
 * @returns {{ delegatorId: string, delegateId: string, requestTypes: string[], startsAt: Date, endsAt: Date }}
 */
function validateDelegation(
  input,
  { isSamePerson = false, delegateIsActive = true } = {}
) {
  if (!input.delegatorId || !input.delegateId) {
    throw new ValidationError("Both delegatorId and delegateId are required.", {
      field: "delegateId",
    });
  }

  if (isSamePerson || String(input.delegatorId) === String(input.delegateId)) {
    throw new ValidationError("You cannot delegate approval to yourself.", {
      field: "delegateId",
    });
  }

  if (!delegateIsActive) {
    throw new ValidationError(
      "The delegate must be an active user.",
      { field: "delegateId" }
    );
  }

  const requestTypes = input.requestTypes ?? [];
  if (!Array.isArray(requestTypes)) {
    throw new ValidationError("requestTypes must be an array.", {
      field: "requestTypes",
    });
  }
  const normalizedTypes = [...new Set(requestTypes.map((t) => String(t).toLowerCase()))];
  const invalid = normalizedTypes.filter((t) => !ALLOWED_REQUEST_TYPES.includes(t));
  if (invalid.length > 0) {
    throw new ValidationError(
      `requestTypes may only contain ${ALLOWED_REQUEST_TYPES.join(", ")}.`,
      { field: "requestTypes" }
    );
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError("A valid startsAt date is required.", {
      field: "startsAt",
    });
  }
  if (Number.isNaN(endsAt.getTime())) {
    throw new ValidationError("A valid endsAt date is required.", {
      field: "endsAt",
    });
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ValidationError("endsAt must be after startsAt.", {
      field: "endsAt",
    });
  }

  return {
    delegatorId: String(input.delegatorId),
    delegateId: String(input.delegateId),
    requestTypes: normalizedTypes,
    startsAt,
    endsAt,
  };
}

/**
 * True when a delegation authorizes the delegate to act for a given request
 * type on the given date: status ACTIVE, date inside [startsAt, endsAt]
 * (inclusive), and requestTypes empty (= all) or containing the request type.
 *
 * @param {{ status?: string, requestTypes?: string[], startsAt: string|Date, endsAt: string|Date }} delegation
 * @param {{ requestType?: string, date?: string|Date }} context
 */
function delegationCovers(delegation, { requestType, date } = {}) {
  if (!delegation || delegation.status !== DELEGATION_STATUS.ACTIVE) {
    return false;
  }

  const onDate = date ? new Date(date) : new Date();
  if (Number.isNaN(onDate.getTime())) return false;

  const startsAt = new Date(delegation.startsAt);
  const endsAt = new Date(delegation.endsAt);
  if (onDate.getTime() < startsAt.getTime() || onDate.getTime() > endsAt.getTime()) {
    return false;
  }

  const covered = delegation.requestTypes ?? [];
  if (covered.length === 0) return true;
  return covered.map((t) => String(t).toLowerCase()).includes(
    String(requestType ?? "").toLowerCase()
  );
}

module.exports = {
  DELEGATION_STATUS,
  ALLOWED_REQUEST_TYPES,
  validateDelegation,
  delegationCovers,
};
