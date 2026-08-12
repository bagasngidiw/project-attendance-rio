/**
 * Timezone helper (FR-060) — converts between UTC instants and the company's
 * local work day.
 *
 * The platform stores instants in UTC but the business operates in a company
 * timezone described by an offset from UTC (`companyTimezoneOffsetMs`, see
 * settings.service.js). These pure functions perform the date-key ↔ UTC
 * conversions that holiday storage and working-day calculations rely on.
 */

const { ValidationError } = require("./errors");

/** Minimum supported UTC offset (-12:00). */
const MIN_TIMEZONE_OFFSET_MS = -12 * 60 * 60 * 1000;

/** Maximum supported UTC offset (+14:00). */
const MAX_TIMEZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

/** Validates a company timezone offset is a finite number within UTC-12..UTC+14. */
function assertTimezoneOffsetMs(offsetMs) {
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) {
    throw new ValidationError("A numeric timezone offset is required.", {
      field: "timezoneOffsetMs",
    });
  }
  if (offsetMs < MIN_TIMEZONE_OFFSET_MS || offsetMs > MAX_TIMEZONE_OFFSET_MS) {
    throw new ValidationError("Timezone offset is out of range.", {
      field: "timezoneOffsetMs",
    });
  }
}

/** Validates a calendar date key is a real, well-formed YYYY-MM-DD date. */
function assertDateKey(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ValidationError("A date in YYYY-MM-DD format is required.", {
      field: "date",
    });
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new ValidationError("A valid date is required.", { field: "date" });
  }
}

/**
 * Returns the company-timezone work day ("YYYY-MM-DD") for a UTC instant.
 *
 * @param {Date|string} dateIso UTC instant (Date or ISO string)
 * @param {number} offsetMs company timezone offset from UTC
 * @returns {string}
 */
function toWorkDay(dateIso, offsetMs = 0) {
  assertTimezoneOffsetMs(offsetMs);
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("A valid UTC instant is required.", {
      field: "date",
    });
  }
  return new Date(date.getTime() + offsetMs).toISOString().slice(0, 10);
}

/**
 * Returns the UTC instant of local midnight for a company work day.
 *
 * @param {string} dateStr work day key ("YYYY-MM-DD")
 * @param {number} offsetMs company timezone offset from UTC
 * @returns {Date}
 */
function fromWorkDay(dateStr, offsetMs = 0) {
  assertTimezoneOffsetMs(offsetMs);
  assertDateKey(dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

module.exports = {
  MIN_TIMEZONE_OFFSET_MS,
  MAX_TIMEZONE_OFFSET_MS,
  assertTimezoneOffsetMs,
  assertDateKey,
  toWorkDay,
  fromWorkDay,
};
