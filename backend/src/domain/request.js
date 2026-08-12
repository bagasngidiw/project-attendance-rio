/**
 * Request domain model (FR-016 / FR-036 / FR-054).
 *
 * One status lifecycle is shared by leave, overtime, and business trip:
 *   DRAFT ─submit─▶ PENDING ─approve─▶ APPROVED
 *                          │─reject──▶ REJECTED
 *                          │─cancel──▶ CANCELLED   (only while PENDING)
 *
 * Every transition is validated by pure functions and recorded as an
 * append-only history entry (FR-008 base). Cancellation is allowed only while
 * PENDING; decided requests are immutable.
 */

const { ValidationError, ConflictError } = require("./errors");

const REQUEST_TYPE = Object.freeze({
  LEAVE: "LEAVE",
  OVERTIME: "OVERTIME",
  TRIP: "TRIP",
  // FR-007: Permission (Ijin) — a distinct request type from Leave.
  PERMISSION: "PERMISSION",
  // TODO.md: Sickness (Sakit) is a distinct business module from Leave/Cuti.
  SAKIT: "SAKIT",
});

const REQUEST_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

/**
 * Allowed-transition matrix (design §3.2). Decided states (APPROVED,
 * REJECTED, CANCELLED) are terminal.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [REQUEST_STATUS.DRAFT]: [REQUEST_STATUS.PENDING],
  [REQUEST_STATUS.PENDING]: [
    REQUEST_STATUS.APPROVED,
    REQUEST_STATUS.REJECTED,
    REQUEST_STATUS.CANCELLED,
  ],
  [REQUEST_STATUS.APPROVED]: [],
  [REQUEST_STATUS.REJECTED]: [],
  [REQUEST_STATUS.CANCELLED]: [],
});

const LEAVE_TYPES = Object.freeze(["SICK", "PERSONAL", "ANNUAL"]);

/** Throws ConflictError(INVALID_STATUS_TRANSITION) for disallowed transitions. */
function assertValidTransition(from, to) {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictError(
      `Cannot move a request from ${from} to ${to}.`,
      "INVALID_STATUS_TRANSITION"
    );
  }
}

/** Cancellation is permitted only while the request is PENDING (FR-016). */
function assertCancelAllowed(status) {
  if (status !== REQUEST_STATUS.PENDING) {
    throw new ConflictError(
      "A request can only be cancelled while it is pending.",
      "INVALID_STATUS_TRANSITION"
    );
  }
}

/**
 * No self-approval guard (FR-007 §3.4): a requester can never decide their
 * own request, even when they hold the matching approval permission.
 */
function assertNoSelfApproval(requesterId, actorId) {
  if (actorId && String(actorId) === String(requesterId)) {
    throw new ConflictError(
      "You cannot approve or reject your own request.",
      "SELF_APPROVAL_DENIED"
    );
  }
}

/** True when a status is terminal (no further transitions allowed). */
function isTerminal(status) {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}

/* ---------------------------------------------------------------------------
 * Per-type payload validation (design §3.1 / A2)
 * ------------------------------------------------------------------------- */

function assertValidDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`A valid ${field} is required.`, { field });
  }
  return date;
}

function assertDateRange(startDate, endDate) {
  const start = assertValidDate(startDate, "startDate");
  const end = assertValidDate(endDate, "endDate");
  if (start.getTime() > end.getTime()) {
    throw new ValidationError("startDate must be on or before endDate.", {
      field: "endDate",
    });
  }
}

function assertTime(value, field) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw new ValidationError(`A valid ${field} (HH:MM) is required.`, {
      field,
    });
  }
  return value;
}

function assertOvertimeRange(startTime, endTime) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (sh * 60 + sm >= eh * 60 + em) {
    throw new ValidationError("endTime must be after startTime.", {
      field: "endTime",
    });
  }
}

function assertRequiredText(value, field) {
  if (!value || !String(value).trim()) {
    throw new ValidationError(`${field} is required.`, { field });
  }
}

/**
 * Validates a leave payload: leave type (existence enforced by the configured
 * leave-type registry in the application layer, FR-058), date range, reason
 * (FR-036).
 *
 * @param {{ leaveType: string, startDate: string, endDate: string, reason: string }} payload
 */
function validateLeavePayload(payload) {
  if (!payload.leaveType || typeof payload.leaveType !== "string" || !payload.leaveType.trim()) {
    throw new ValidationError("A leave type is required.", {
      field: "leaveType",
    });
  }
  assertDateRange(payload.startDate, payload.endDate);
  assertRequiredText(payload.reason, "reason");
}

/**
 * Validates an overtime payload: date, time range, reason (FR-054).
 *
 * @param {{ date: string, startTime: string, endTime: string, reason: string }} payload
 */
function validateOvertimePayload(payload) {
  assertValidDate(payload.date, "date");
  assertTime(payload.startTime, "startTime");
  assertTime(payload.endTime, "endTime");
  assertOvertimeRange(payload.startTime, payload.endTime);
  assertRequiredText(payload.reason, "reason");
}

/**
 * Validates a trip payload: destination, date range, purpose (FR-054).
 *
 * @param {{ destination: string, startDate: string, endDate: string, purpose: string }} payload
 */
function validateTripPayload(payload) {
  assertRequiredText(payload.destination, "destination");
  assertDateRange(payload.startDate, payload.endDate);
  assertRequiredText(payload.purpose, "purpose");
}

/**
 * Validates a Permission (Ijin) payload (FR-007): a single date OR a date
 * range, plus a required reason.
 *
 * @param {{ date?: string, startDate?: string, endDate?: string, reason: string }} payload
 */
function validatePermissionPayload(payload) {
  assertRequiredText(payload.reason, "reason");
  if (payload.date) {
    assertValidDate(payload.date, "date");
    return;
  }
  if (payload.startDate || payload.endDate) {
    assertDateRange(payload.startDate, payload.endDate);
    return;
  }
  throw new ValidationError("Either a date or a date range is required.", {
    field: "date",
  });
}

/**
 * Validates a Sickness (Sakit) payload (TODO.md §3): a sickness type, start
 * date (+ optional end date), and a required reason/description.
 *
 * @param {{ sicknessType: string, startDate: string, endDate?: string, reason: string }} payload
 */
function validateSakitPayload(payload) {
  assertRequiredText(payload.sicknessType, "sicknessType");
  if (payload.endDate && payload.endDate !== payload.startDate) {
    assertDateRange(payload.startDate, payload.endDate);
  } else if (!payload.endDate) {
    assertValidDate(payload.startDate, "startDate");
  } else {
    assertValidDate(payload.startDate, "startDate");
  }
  assertRequiredText(payload.reason, "reason");
}

module.exports = {
  REQUEST_TYPE,
  REQUEST_STATUS,
  LEAVE_TYPES,
  ALLOWED_TRANSITIONS,
  assertValidTransition,
  assertCancelAllowed,
  assertNoSelfApproval,
  isTerminal,
  validateLeavePayload,
  validateOvertimePayload,
  validateTripPayload,
  validatePermissionPayload,
  validateSakitPayload,
};
