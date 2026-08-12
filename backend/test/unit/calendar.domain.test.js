/**
 * Calendar domain tests (FR-059): holiday validation, weekend detection,
 * working-day evaluation, and inclusive business-day counting.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateHoliday,
  holidayDateKey,
  isWeekend,
  isWorkingDay,
  countBusinessDays,
} = require("../../src/domain/calendar");
const { ValidationError } = require("../../src/domain/errors");

test("validateHoliday accepts a valid input and normalizes it", () => {
  const result = validateHoliday({ date: "2026-09-01", name: "  National Day  " });
  assert.deepEqual(result, { date: "2026-09-01", name: "National Day", repeatYearly: false });
  assert.deepEqual(validateHoliday({ date: "2026-09-01", name: "A", repeatYearly: true }), {
    date: "2026-09-01",
    name: "A",
    repeatYearly: true,
  });
});

test("validateHoliday rejects missing/invalid dates", () => {
  assert.throws(
    () => validateHoliday({ name: "X" }),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
  assert.throws(
    () => validateHoliday({ date: "", name: "X" }),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
  assert.throws(
    () => validateHoliday({ date: "2026-02-30", name: "X" }),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
  assert.throws(
    () => validateHoliday({ date: "not-a-date", name: "X" }),
    ValidationError
  );
});

test("validateHoliday rejects invalid names", () => {
  assert.throws(
    () => validateHoliday({ date: "2026-09-01", name: "   " }),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  assert.throws(
    () => validateHoliday({ date: "2026-09-01", name: "x".repeat(101) }),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
});

test("validateHoliday rejects a non-boolean repeatYearly", () => {
  assert.throws(
    () => validateHoliday({ date: "2026-09-01", name: "X", repeatYearly: "yes" }),
    (err) => err instanceof ValidationError && err.details.field === "repeatYearly"
  );
});

test("isWeekend detects Saturday and Sunday only", () => {
  // 2026-08-08 is a Saturday, 2026-08-09 a Sunday, 2026-08-10 a Monday.
  assert.equal(isWeekend("2026-08-08"), true);
  assert.equal(isWeekend("2026-08-09"), true);
  assert.equal(isWeekend("2026-08-10"), false);
  assert.equal(isWeekend("2026-08-07"), false);
});

test("isWorkingDay excludes weekends by default and honors useWeekends=false", () => {
  assert.equal(isWorkingDay("2026-08-10"), true);
  assert.equal(isWorkingDay("2026-08-08"), false, "Saturday is off by default");
  assert.equal(isWorkingDay("2026-08-08", { useWeekends: false }), true);
});

test("isWorkingDay treats holidays as non-working regardless of weekend toggle", () => {
  const holidays = ["2026-08-10", { date: new Date("2026-08-11T00:00:00Z") }, { date: "2026-08-12" }];
  assert.equal(isWorkingDay("2026-08-10", { holidays }), false, "string holiday");
  assert.equal(isWorkingDay("2026-08-11", { holidays }), false, "Date holiday");
  assert.equal(isWorkingDay("2026-08-12", { holidays }), false, "record holiday");
  assert.equal(isWorkingDay("2026-08-13", { holidays }), true, "adjacent day unaffected");
});

test("holidayDateKey normalizes strings, Dates, and records", () => {
  assert.equal(holidayDateKey("2026-09-01"), "2026-09-01");
  assert.equal(holidayDateKey(new Date("2026-09-01T00:00:00Z")), "2026-09-01");
  assert.equal(holidayDateKey({ date: "2026-09-01" }), "2026-09-01");
  assert.equal(holidayDateKey({ date: new Date("2026-09-01T00:00:00Z") }), "2026-09-01");
  assert.equal(holidayDateKey(null), "");
});

test("countBusinessDays counts inclusive weekdays", () => {
  // Monday 2026-08-10 through Friday 2026-08-14 => 5 business days.
  assert.equal(countBusinessDays("2026-08-10", "2026-08-14"), 5);
  // Same-day range is one business day.
  assert.equal(countBusinessDays("2026-08-10", "2026-08-10"), 1);
  // Friday -> Monday spans a weekend: 2 business days.
  assert.equal(countBusinessDays("2026-08-07", "2026-08-10"), 2);
});

test("countBusinessDays excludes holidays", () => {
  const holidays = ["2026-08-11", "2026-08-12"];
  assert.equal(countBusinessDays("2026-08-10", "2026-08-14", { holidays }), 3);
});

test("countBusinessDays counts weekends when useWeekends=false", () => {
  assert.equal(countBusinessDays("2026-08-07", "2026-08-10", { useWeekends: false }), 4);
});

test("countBusinessDays rejects an inverted range", () => {
  assert.throws(
    () => countBusinessDays("2026-08-14", "2026-08-10"),
    (err) => err instanceof ValidationError && err.details.field === "from"
  );
});

test("countBusinessDays validates its date keys", () => {
  assert.throws(() => countBusinessDays("bad", "2026-08-10"), ValidationError);
  assert.throws(() => countBusinessDays("2026-08-10", "bad"), ValidationError);
});
