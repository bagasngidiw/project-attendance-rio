/**
 * Configurable overtime / business-trip business rules (FR-046).
 *
 * Pure module: rule normalization, structural validation, and payload
 * enforcement carry no I/O. Weekly overtime totals and per-month trip counts
 * require knowledge of other requests, so those comparisons read them from an
 * optional `context` argument (e.g. { weekHours, tripsThisMonth }); every other
 * rule is evaluated from the payload alone. Violations throw a ValidationError
 * tagged with the offending field.
 */

const { ValidationError } = require("./errors");

const BUSINESS_RULE_TYPES = Object.freeze(["overtime", "trip"]);

/** Default overtime rules (applied when a key is unset or not configured). */
const OVERTIME_RULES_DEFAULTS = Object.freeze({
  maxHoursPerDay: 12,
  maxHoursPerWeek: 40,
  advanceNoticeHours: 0,
  earliestStartHour: 6,
  latestStartHour: 22,
});

/** Default trip rules (applied when a key is unset or not configured). */
const TRIP_RULES_DEFAULTS = Object.freeze({
  maxTripDays: 30,
  advanceNoticeHours: 24,
  maxTripsPerMonth: 5,
});

const RULES_DEFAULTS = Object.freeze({
  overtime: OVERTIME_RULES_DEFAULTS,
  trip: TRIP_RULES_DEFAULTS,
});

/** Inclusive ranges per numeric rule key. */
const RULES_RANGES = Object.freeze({
  maxHoursPerDay: { min: 1, max: 24 },
  maxHoursPerWeek: { min: 1, max: 24 * 7 },
  advanceNoticeHours: { min: 0, max: 24 * 365 },
  earliestStartHour: { min: 0, max: 23 },
  latestStartHour: { min: 0, max: 23 },
  maxTripDays: { min: 1, max: 365 },
  maxTripsPerMonth: { min: 1, max: 100 },
});

const RULES_KEYS_BY_TYPE = Object.freeze({
  overtime: Object.keys(OVERTIME_RULES_DEFAULTS),
  trip: Object.keys(TRIP_RULES_DEFAULTS),
});

/** Copies a raw rules map onto the defaults for a type, keeping only known keys. */
function pickKnownKeys(type, raw) {
  const result = { ...RULES_DEFAULTS[type] };
  if (raw && typeof raw === "object") {
    for (const key of RULES_KEYS_BY_TYPE[type]) {
      if (raw[key] !== undefined) result[key] = raw[key];
    }
  }
  return result;
}

/**
 * Merges a raw rules map (either a { overtime?, trip? } map or a single-type
 * object applied to both) with the defaults for both types. Each type only
 * carries its own known keys.
 *
 * @param {object} [raw] { overtime?: object, trip?: object } or a single-type object
 * @returns {{ overtime: object, trip: object }}
 */
function normalizeRules(raw = {}) {
  const source =
    raw && typeof raw === "object" && (raw.overtime || raw.trip)
      ? raw
      : { overtime: raw, trip: raw };
  return {
    overtime: normalizeOvertimeRules(source.overtime),
    trip: normalizeTripRules(source.trip),
  };
}

/** Merges overtime rule overrides with the overtime defaults. */
function normalizeOvertimeRules(raw = {}) {
  return pickKnownKeys("overtime", raw);
}

/** Merges trip rule overrides with the trip defaults. */
function normalizeTripRules(raw = {}) {
  return pickKnownKeys("trip", raw);
}

function assertNumberInRange(rules, key) {
  const range = RULES_RANGES[key];
  const value = rules[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ValidationError(`${key} must be a number.`, { field: key });
  }
  if (value < range.min || value > range.max) {
    throw new ValidationError(
      `${key} must be between ${range.min} and ${range.max}.`,
      { field: key }
    );
  }
}

/**
 * Structurally validates overtime rules (types + ranges) and returns them.
 *
 * @param {object} rules normalized overtime rules
 * @returns {object} validated overtime rules
 */
function validateOvertimeRules(rules = {}) {
  for (const key of RULES_KEYS_BY_TYPE.overtime) {
    assertNumberInRange(rules, key);
  }
  if (rules.earliestStartHour > rules.latestStartHour) {
    throw new ValidationError(
      "earliestStartHour must not exceed latestStartHour.",
      { field: "earliestStartHour" }
    );
  }
  return { ...rules };
}

/**
 * Structurally validates trip rules (types + ranges) and returns them.
 *
 * @param {object} rules normalized trip rules
 * @returns {object} validated trip rules
 */
function validateTripRules(rules = {}) {
  for (const key of RULES_KEYS_BY_TYPE.trip) {
    assertNumberInRange(rules, key);
  }
  return { ...rules };
}

/** Parses an HH:MM time into minutes since midnight; null when malformed. */
function parseTimeMinutes(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function assertDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`A valid ${field} is required.`, { field });
  }
  return date;
}

/**
 * Monday–Sunday range of the week containing `date` (ISO day start).
 *
 * @param {Date} date
 * @returns {{ start: string, end: string }} ISO date strings, inclusive
 */
function weekRangeForDate(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  const end = d.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Enforces overtime rules against a submission payload. Computes the shift
 * hours from startTime/endTime, checks the daily cap, the start-time window,
 * advance notice, and (when context.weekHours is supplied) the weekly cap.
 *
 * @param {{ date?: string, overtimeDate?: string, startTime?: string, endTime?: string }} payload
 * @param {object} [rules] raw overtime rules (normalized internally)
 * @param {{ weekHours?: number }} [context] overtime hours already recorded in the Mon–Sun week of the payload date
 * @returns {{ hours: number, weekRange: { start: string, end: string } }}
 */
function enforceOvertimeRules(payload = {}, rules = {}, context = {}) {
  const effective = validateOvertimeRules(normalizeOvertimeRules(rules));

  const startMinutes = parseTimeMinutes(payload.startTime);
  if (startMinutes === null) {
    throw new ValidationError("A valid startTime (HH:MM) is required.", {
      field: "startTime",
    });
  }
  const endMinutes = parseTimeMinutes(payload.endTime);
  if (endMinutes === null) {
    throw new ValidationError("A valid endTime (HH:MM) is required.", {
      field: "endTime",
    });
  }
  if (endMinutes <= startMinutes) {
    throw new ValidationError("endTime must be after startTime.", {
      field: "endTime",
    });
  }

  const hours = (endMinutes - startMinutes) / 60;
  if (hours > effective.maxHoursPerDay) {
    throw new ValidationError(
      `Overtime exceeds the ${effective.maxHoursPerDay} hour daily limit.`,
      { field: "endTime" }
    );
  }

  // The overtime date field is `date` in the submission payload (FR-054);
  // `overtimeDate` is tolerated as an alias.
  const overtimeDate = payload.date ?? payload.overtimeDate;
  const dayStart = assertDate(overtimeDate, "date");

  const weekRange = weekRangeForDate(dayStart);
  if (typeof context.weekHours === "number") {
    if (context.weekHours + hours > effective.maxHoursPerWeek) {
      throw new ValidationError(
        `Overtime exceeds the ${effective.maxHoursPerWeek} hour weekly limit.`,
        { field: "date" }
      );
    }
  }

  if (effective.advanceNoticeHours > 0) {
    const now = new Date();
    const advanceHours = (dayStart.getTime() - now.getTime()) / 3600000;
    if (advanceHours < effective.advanceNoticeHours) {
      throw new ValidationError(
        `Overtime must be requested at least ${effective.advanceNoticeHours} hours in advance.`,
        { field: "date" }
      );
    }
  }

  const startHour = startMinutes / 60;
  if (startHour < effective.earliestStartHour) {
    throw new ValidationError(
      `Overtime cannot start before ${pad(effective.earliestStartHour)}:00.`,
      { field: "startTime" }
    );
  }
  if (startHour > effective.latestStartHour) {
    throw new ValidationError(
      `Overtime cannot start after ${pad(effective.latestStartHour)}:00.`,
      { field: "startTime" }
    );
  }

  return { hours, weekRange };
}

/**
 * Enforces trip rules against a submission payload: inclusive duration in days,
 * advance notice, and (when context.tripsThisMonth is supplied) the per-month
 * cap.
 *
 * @param {{ startDate?: string, endDate?: string }} payload
 * @param {object} [rules] raw trip rules (normalized internally)
 * @param {{ tripsThisMonth?: number }} [context] trips already booked in the month of startDate
 * @returns {{ days: number }}
 */
function enforceTripRules(payload = {}, rules = {}, context = {}) {
  const effective = validateTripRules(normalizeTripRules(rules));

  const startDate = assertDate(payload.startDate, "startDate");
  const endDate = assertDate(payload.endDate, "endDate");
  if (endDate.getTime() < startDate.getTime()) {
    throw new ValidationError("endDate must be on or after startDate.", {
      field: "endDate",
    });
  }

  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  if (days > effective.maxTripDays) {
    throw new ValidationError(
      `Trip exceeds the ${effective.maxTripDays} day limit.`,
      { field: "endDate" }
    );
  }

  if (effective.advanceNoticeHours > 0) {
    const now = new Date();
    const advanceHours = (startDate.getTime() - now.getTime()) / 3600000;
    if (advanceHours < effective.advanceNoticeHours) {
      throw new ValidationError(
        `Trip must be requested at least ${effective.advanceNoticeHours} hours in advance.`,
        { field: "startDate" }
      );
    }
  }

  if (typeof context.tripsThisMonth === "number" && context.tripsThisMonth >= effective.maxTripsPerMonth) {
    throw new ValidationError(
      `Only ${effective.maxTripsPerMonth} trips per month are allowed.`,
      { field: "startDate" }
    );
  }

  return { days };
}

module.exports = {
  BUSINESS_RULE_TYPES,
  OVERTIME_RULES_DEFAULTS,
  TRIP_RULES_DEFAULTS,
  RULES_DEFAULTS,
  RULES_RANGES,
  normalizeRules,
  normalizeOvertimeRules,
  normalizeTripRules,
  validateOvertimeRules,
  validateTripRules,
  enforceOvertimeRules,
  enforceTripRules,
  weekRangeForDate,
};
