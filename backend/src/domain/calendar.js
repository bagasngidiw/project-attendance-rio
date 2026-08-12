/**
 * Company calendar domain model (FR-059).
 *
 * Pure functions over calendar date keys ("YYYY-MM-DD"): holiday validation,
 * weekend detection, and working-day / business-day counting. Weekends are
 * Saturday and Sunday by default but can be toggled off for calendars where
 * the company operates weekends. Holidays are supplied as date keys, Date
 * objects, or `{ date }` records and always take precedence over weekends.
 */

const { ValidationError } = require("./errors");
const { assertDateKey } = require("./timezone.helper");

const HOLIDAY_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

/** Maximum length of a holiday name. */
const MAX_HOLIDAY_NAME_LENGTH = 100;

/**
 * Validates holiday input and returns a normalized copy.
 *
 * @param {{ date: string, name: string, repeatYearly?: boolean }} input
 * @returns {{ date: string, name: string, repeatYearly: boolean }}
 */
function validateHoliday(input = {}) {
  const { date, name, repeatYearly } = input;

  if (date == null || date === "") {
    throw new ValidationError("A date is required.", { field: "date" });
  }
  const dateKey = date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
  assertDateKey(dateKey);

  if (name == null || String(name).trim() === "") {
    throw new ValidationError("A name is required.", { field: "name" });
  }
  if (String(name).trim().length > MAX_HOLIDAY_NAME_LENGTH) {
    throw new ValidationError(
      `Holiday name must be ${MAX_HOLIDAY_NAME_LENGTH} characters or fewer.`,
      { field: "name" }
    );
  }

  if (repeatYearly !== undefined && typeof repeatYearly !== "boolean") {
    throw new ValidationError("repeatYearly must be a boolean.", {
      field: "repeatYearly",
    });
  }

  return {
    date: dateKey,
    name: String(name).trim(),
    repeatYearly: repeatYearly ?? false,
  };
}

/** Extracts a "YYYY-MM-DD" key from a holiday value (string, Date, or record). */
function holidayDateKey(holiday) {
  if (holiday == null) return "";
  if (typeof holiday === "string") return holiday;
  if (holiday instanceof Date) return holiday.toISOString().slice(0, 10);
  if (holiday.date != null) {
    if (typeof holiday.date === "string") return holiday.date;
    if (holiday.date instanceof Date) return holiday.date.toISOString().slice(0, 10);
  }
  return "";
}

/**
 * True when a date key falls on a weekend (Saturday or Sunday).
 *
 * @param {string} dateStr date key ("YYYY-MM-DD")
 * @returns {boolean}
 */
function isWeekend(dateStr) {
  assertDateKey(dateStr);
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * True when a date key is a working day: not a holiday and (unless disabled)
 * not a weekend.
 *
 * @param {string} dateStr date key ("YYYY-MM-DD")
 * @param {{ holidays?: Array<string|Date|{ date: Date|string }>, useWeekends?: boolean }} options
 * @returns {boolean}
 */
function isWorkingDay(dateStr, { holidays = [], useWeekends = true } = {}) {
  assertDateKey(dateStr);
  const holidayKeys = new Set(
    holidays.map(holidayDateKey).filter((key) => key.length > 0)
  );
  if (holidayKeys.has(dateStr)) return false;
  if (useWeekends && isWeekend(dateStr)) return false;
  return true;
}

/**
 * Counts business days in the inclusive range [from, to].
 *
 * @param {string} from date key ("YYYY-MM-DD")
 * @param {string} to date key ("YYYY-MM-DD")
 * @param {{ holidays?: Array, useWeekends?: boolean }} options
 * @returns {number}
 */
function countBusinessDays(from, to, { holidays = [], useWeekends = true } = {}) {
  assertDateKey(from);
  assertDateKey(to);
  if (from > to) {
    throw new ValidationError("from must be on or before to.", { field: "from" });
  }
  let count = 0;
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    if (isWorkingDay(cursor.toISOString().slice(0, 10), { holidays, useWeekends })) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

module.exports = {
  HOLIDAY_STATUS,
  MAX_HOLIDAY_NAME_LENGTH,
  validateHoliday,
  holidayDateKey,
  isWeekend,
  isWorkingDay,
  countBusinessDays,
};
