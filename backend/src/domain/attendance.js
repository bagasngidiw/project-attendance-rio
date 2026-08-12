/**
 * Attendance domain model (FR-035 / FR-020 / FR-041).
 *
 * One attendance record per user per work day, storing UTC instants for clock
 * in/out and a company-timezone `date` key. Work-period rules prevent
 * double clock-ins and clock-outs without an open period. Exceptions are
 * detected by pure rules and surfaced rather than hidden. Corrections are
 * append-only and block self-correction.
 */

const { ValidationError, ConflictError } = require("./errors");

const ATTENDANCE_STATUS = Object.freeze({
  NORMAL: "NORMAL",
  EXCEPTION: "EXCEPTION",
  // FR-001: approved leave creates a LEAVE record; the employee must not
  // clock in/out on those dates.
  LEAVE: "LEAVE",
});

const EXCEPTION_TYPES = Object.freeze([
  "MISSING_CLOCK_IN",
  "MISSING_CLOCK_OUT",
  "DUPLICATE",
  "CONFLICT",
  "ANOMALY",
]);

const SOURCE_TYPES = Object.freeze({
  SELF: "SELF",
  CORRECTION: "CORRECTION",
});

/** Anomaly bounds (FR-041 §3.3): a shift under 1h or over 16h is flagged. */
const MIN_SHIFT_HOURS = 1;
const MAX_SHIFT_HOURS = 16;

/** Formats a UTC instant as the company-timezone work day (YYYY-MM-DD). */
function toWorkDay(date, timezoneOffsetMs = 0) {
  return new Date(date.getTime() + timezoneOffsetMs).toISOString().slice(0, 10);
}

/** True when the record's work day has already ended (open shift → exception). */
function isPastWorkDay(dateKey, now = new Date(), timezoneOffsetMs = 0) {
  const todayKey = toWorkDay(now, timezoneOffsetMs);
  return dateKey < todayKey;
}

/**
 * Computes exception types for a record (FR-041 §3.3). DUPLICATE/CONFLICT are
 * prevented by the work-period rules and can only surface via corrections.
 *
 * @param {{ date: string, clockInAt?: Date|null, clockOutAt?: Date|null }} record
 * @param {Date} [now]
 * @param {number} [timezoneOffsetMs]
 * @returns {string[]}
 */
function computeExceptions(record, now = new Date(), timezoneOffsetMs = 0) {
  const types = [];
  const clockInAt = record.clockInAt ? new Date(record.clockInAt) : null;
  const clockOutAt = record.clockOutAt ? new Date(record.clockOutAt) : null;

  // Open shift after the work day ended.
  if (!clockOutAt && isPastWorkDay(record.date, now, timezoneOffsetMs)) {
    types.push("MISSING_CLOCK_OUT");
  }
  // Clock-out without a clock-in (correction-produced).
  if (clockOutAt && !clockInAt) {
    types.push("MISSING_CLOCK_IN");
  }
  // Duration outside configured bounds.
  if (clockInAt && clockOutAt) {
    const hours = (clockOutAt.getTime() - clockInAt.getTime()) / 36e5;
    if (hours < MIN_SHIFT_HOURS || hours > MAX_SHIFT_HOURS) {
      types.push("ANOMALY");
    }
  }
  return [...new Set(types)];
}

/** Derives the record status from its exception types. */
function computeStatus(exceptionTypes) {
  return exceptionTypes.length > 0
    ? ATTENDANCE_STATUS.EXCEPTION
    : ATTENDANCE_STATUS.NORMAL;
}

/**
 * Blocks a clock-in when a work period already exists for the day — whether
 * open or already closed — enforcing one work period per user per day
 * (FR-035 §3.2). Closed periods can only be re-opened by HR correction.
 */
function assertClockInAllowed(record) {
  if (record) {
    const open = record.clockOutAt == null;
    throw new ConflictError(
      open
        ? "A work period is already open; clock out before clocking in again."
        : "A work period for today is already complete. Contact HR to correct it.",
      "INVALID_CLOCK_ACTION"
    );
  }
}

/** Blocks a clock-out when no open work period exists (FR-035 §3.2). */
function assertClockOutAllowed(openPeriod) {
  if (!openPeriod || openPeriod.clockOutAt != null) {
    throw new ConflictError(
      "No open work period to clock out from.",
      "INVALID_CLOCK_ACTION"
    );
  }
}

/** Clock-out must occur after clock-in. */
function assertClockOutAfterIn(clockInAt, clockOutAt) {
  if (clockOutAt <= clockInAt) {
    throw new ValidationError("clockOutAt must be after clockInAt.", {
      field: "clockOutAt",
    });
  }
}

/** Employees can never correct their own attendance records (FR-020). */
function assertSelfCorrectionDenied(userId, actorId) {
  if (actorId && String(userId) === String(actorId)) {
    throw new ConflictError(
      "Employees cannot correct their own attendance records.",
      "SELF_CORRECTION_DENIED"
    );
  }
}

/** A correction reason is always required (FR-020 §3.5). */
function assertCorrectionReason(reason) {
  if (!reason || !String(reason).trim()) {
    throw new ValidationError("A correction reason is required.", {
      field: "reason",
    });
  }
}

/** True when the record represents an approved-leave day (FR-001). */
function isLeaveRecord(record) {
  return record?.status === ATTENDANCE_STATUS.LEAVE;
}

/**
 * Blocks clock-in/out while the user is on approved leave (FR-001). The
 * caller only invokes this after confirming the user's work day is covered by
 * an approved leave (via the coverage query or an existing LEAVE record), so
 * a non-null record here always represents the leave day.
 *
 * @param {object|null} record
 * @throws {ConflictError} code ON_APPROVED_LEAVE
 */
function assertClockAllowedOnLeave(record) {
  if (!record || isLeaveRecord(record)) {
    throw new ConflictError(
      "Anda sedang dalam cuti yang disetujui. Absensi tidak diperlukan.",
      "ON_APPROVED_LEAVE"
    );
  }
}

module.exports = {
  ATTENDANCE_STATUS,
  EXCEPTION_TYPES,
  SOURCE_TYPES,
  MIN_SHIFT_HOURS,
  MAX_SHIFT_HOURS,
  toWorkDay,
  isPastWorkDay,
  computeExceptions,
  computeStatus,
  assertClockInAllowed,
  assertClockOutAllowed,
  assertClockOutAfterIn,
  assertSelfCorrectionDenied,
  assertCorrectionReason,
  isLeaveRecord,
  assertClockAllowedOnLeave,
};
