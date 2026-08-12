/**
 * Business-rules domain tests (FR-046): default merging, structural
 * validation (types + ranges), and enforcement violations for every rule.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  OVERTIME_RULES_DEFAULTS,
  TRIP_RULES_DEFAULTS,
  normalizeRules,
  normalizeOvertimeRules,
  normalizeTripRules,
  validateOvertimeRules,
  validateTripRules,
  enforceOvertimeRules,
  enforceTripRules,
  weekRangeForDate,
} = require("../../src/domain/business-rules");
const { ValidationError } = require("../../src/domain/errors");

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Normalization (defaults)                                            */
/* ------------------------------------------------------------------ */

test("business-rules normalizeRules merges defaults for both types", () => {
  const rules = normalizeRules({
    overtime: { maxHoursPerDay: 8 },
    trip: { maxTripDays: 14 },
  });
  assert.equal(rules.overtime.maxHoursPerDay, 8);
  assert.equal(rules.overtime.maxHoursPerWeek, OVERTIME_RULES_DEFAULTS.maxHoursPerWeek);
  assert.equal(rules.trip.maxTripDays, 14);
  assert.equal(rules.trip.advanceNoticeHours, TRIP_RULES_DEFAULTS.advanceNoticeHours);
});

test("business-rules normalizeRules handles null / single-type input", () => {
  const defaults = normalizeRules(null);
  assert.deepEqual(defaults.overtime, OVERTIME_RULES_DEFAULTS);
  assert.deepEqual(defaults.trip, TRIP_RULES_DEFAULTS);

  const single = normalizeRules({ maxHoursPerDay: 10 });
  assert.equal(single.overtime.maxHoursPerDay, 10);
  assert.equal(single.trip.maxHoursPerDay, undefined, "trip has no overtime keys");
  assert.equal(single.trip.maxTripDays, TRIP_RULES_DEFAULTS.maxTripDays);
});

test("business-rules per-type normalizers merge partial overrides", () => {
  assert.deepEqual(normalizeOvertimeRules({ maxHoursPerDay: 9 }), {
    ...OVERTIME_RULES_DEFAULTS,
    maxHoursPerDay: 9,
  });
  assert.deepEqual(normalizeTripRules({ maxTripsPerMonth: 2 }), {
    ...TRIP_RULES_DEFAULTS,
    maxTripsPerMonth: 2,
  });
  assert.deepEqual(normalizeOvertimeRules(null), OVERTIME_RULES_DEFAULTS);
});

/* ------------------------------------------------------------------ */
/* Structural validation                                               */
/* ------------------------------------------------------------------ */

test("business-rules validateOvertimeRules accepts valid rules and returns them", () => {
  const rules = validateOvertimeRules(normalizeOvertimeRules({ maxHoursPerDay: 10 }));
  assert.equal(rules.maxHoursPerDay, 10);
});

test("business-rules validateOvertimeRules rejects wrong types, ranges, and window inversion", () => {
  assert.throws(
    () => validateOvertimeRules(normalizeOvertimeRules({ maxHoursPerDay: "12" })),
    (err) => err instanceof ValidationError && err.details.field === "maxHoursPerDay"
  );
  assert.throws(
    () => validateOvertimeRules(normalizeOvertimeRules({ maxHoursPerDay: 25 })),
    (err) => err instanceof ValidationError && err.details.field === "maxHoursPerDay"
  );
  assert.throws(
    () => validateOvertimeRules(normalizeOvertimeRules({ latestStartHour: 24 })),
    (err) => err instanceof ValidationError && err.details.field === "latestStartHour"
  );
  assert.throws(
    () => validateOvertimeRules(normalizeOvertimeRules({ earliestStartHour: 20, latestStartHour: 9 })),
    (err) => err instanceof ValidationError && err.details.field === "earliestStartHour"
  );
});

test("business-rules validateTripRules rejects wrong types and ranges", () => {
  assert.throws(
    () => validateTripRules(normalizeTripRules({ maxTripDays: "7" })),
    (err) => err instanceof ValidationError && err.details.field === "maxTripDays"
  );
  assert.throws(
    () => validateTripRules(normalizeTripRules({ maxTripDays: 0 })),
    (err) => err instanceof ValidationError && err.details.field === "maxTripDays"
  );
  assert.throws(
    () => validateTripRules(normalizeTripRules({ maxTripsPerMonth: 101 })),
    (err) => err instanceof ValidationError && err.details.field === "maxTripsPerMonth"
  );
});

/* ------------------------------------------------------------------ */
/* Overtime enforcement                                                */
/* ------------------------------------------------------------------ */

test("overtime enforcement rejects hours over maxHoursPerDay", () => {
  const rules = normalizeOvertimeRules({ maxHoursPerDay: 4, advanceNoticeHours: 0 });
  assert.throws(
    () => enforceOvertimeRules(
      { date: daysFromNow(5), startTime: "09:00", endTime: "14:00" },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "endTime"
  );
});

test("overtime enforcement rejects when the Mon–Sun week total exceeds maxHoursPerWeek", () => {
  const rules = normalizeOvertimeRules({ maxHoursPerWeek: 40, advanceNoticeHours: 0 });
  assert.throws(
    () => enforceOvertimeRules(
      { date: daysFromNow(5), startTime: "09:00", endTime: "17:00" }, // 8h
      rules,
      { weekHours: 36 }
    ),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
});

test("overtime enforcement rejects insufficient advance notice", () => {
  const rules = normalizeOvertimeRules({ advanceNoticeHours: 48 });
  assert.throws(
    () => enforceOvertimeRules(
      { date: daysFromNow(1), startTime: "09:00", endTime: "11:00" },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
});

test("overtime enforcement rejects start times outside [earliestStartHour, latestStartHour]", () => {
  const rules = normalizeOvertimeRules({ earliestStartHour: 6, latestStartHour: 22, advanceNoticeHours: 0 });
  assert.throws(
    () => enforceOvertimeRules(
      { date: daysFromNow(5), startTime: "04:00", endTime: "06:00" },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "startTime"
  );
  assert.throws(
    () => enforceOvertimeRules(
      { date: daysFromNow(5), startTime: "23:00", endTime: "23:30" },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "startTime"
  );
});

test("overtime enforcement returns computed hours + week range for a valid payload", () => {
  const result = enforceOvertimeRules(
    { date: daysFromNow(5), startTime: "09:00", endTime: "17:00" },
    normalizeOvertimeRules({ advanceNoticeHours: 0 })
  );
  assert.equal(result.hours, 8);
  const week = weekRangeForDate(new Date(`${daysFromNow(5)}T00:00:00Z`));
  assert.deepEqual(result.weekRange, week);
  assert.ok(week.start < week.end, "Mon–Sun week range is ordered");
});

test("overtime enforcement accepts the overtimeDate alias and defaults advance notice to 0", () => {
  const result = enforceOvertimeRules(
    { overtimeDate: daysFromNow(5), startTime: "10:00", endTime: "12:00" },
    {}
  );
  assert.equal(result.hours, 2);
});

/* ------------------------------------------------------------------ */
/* Trip enforcement                                                    */
/* ------------------------------------------------------------------ */

test("trip enforcement rejects trips longer than maxTripDays", () => {
  const rules = normalizeTripRules({ maxTripDays: 7, advanceNoticeHours: 0 });
  const start = daysFromNow(10);
  const end = daysFromNow(10 + 9); // 10 inclusive days
  assert.throws(
    () => enforceTripRules({ startDate: start, endDate: end }, rules),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
});

test("trip enforcement rejects insufficient advance notice", () => {
  const rules = normalizeTripRules({ maxTripDays: 30, advanceNoticeHours: 24 });
  assert.throws(
    () => enforceTripRules(
      { startDate: daysFromNow(0), endDate: daysFromNow(2) },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "startDate"
  );
});

test("trip enforcement rejects when maxTripsPerMonth is reached", () => {
  const rules = normalizeTripRules({ maxTripsPerMonth: 3, advanceNoticeHours: 0 });
  assert.throws(
    () => enforceTripRules(
      { startDate: daysFromNow(10), endDate: daysFromNow(12) },
      rules,
      { tripsThisMonth: 3 }
    ),
    (err) => err instanceof ValidationError && err.details.field === "startDate"
  );
});

test("trip enforcement rejects endDate before startDate", () => {
  const rules = normalizeTripRules({ advanceNoticeHours: 0 });
  assert.throws(
    () => enforceTripRules(
      { startDate: daysFromNow(10), endDate: daysFromNow(8) },
      rules
    ),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
});

test("trip enforcement returns inclusive days for a valid payload", () => {
  const start = daysFromNow(15);
  const end = daysFromNow(17);
  const result = enforceTripRules(
    { startDate: start, endDate: end },
    normalizeTripRules({ advanceNoticeHours: 0 })
  );
  assert.equal(result.days, 3);
});
