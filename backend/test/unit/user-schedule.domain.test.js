/**
 * User work-schedule domain tests (TODO.md §11/§12): working-day detection
 * and punctuality evaluation consumed by the attendance module.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  computePunctuality,
  isWorkingDay,
  validateWorkSchedule,
} = require("../../src/domain/user-schedule");
const { ValidationError } = require("../../src/domain/errors");

test("isWorkingDay uses Mon-Fri as the default when no days are configured", () => {
  assert.equal(isWorkingDay([], "2026-08-06"), true); // Thursday
  assert.equal(isWorkingDay(undefined, "2026-08-06"), true);
  assert.equal(isWorkingDay([], "2026-08-09"), false); // Sunday
});

test("isWorkingDay honors explicit working days (0=Sun..6=Sat)", () => {
  assert.equal(isWorkingDay([6], "2026-08-08"), true); // Saturday
  assert.equal(isWorkingDay([6], "2026-08-09"), false); // Sunday
});

test("computePunctuality is null when there is no clock-in", () => {
  assert.equal(computePunctuality({ date: "2026-08-06", clockInAt: null }, { workingDays: [1, 2, 3, 4, 5], workingStartTime: "08:00" }), null);
});

test("computePunctuality is null on a non-working day even when late", () => {
  const result = computePunctuality(
    { date: "2026-08-09", clockInAt: new Date("2026-08-09T12:00:00.000Z") }, // Sunday
    { workingDays: [1, 2, 3, 4, 5], workingStartTime: "08:00" }
  );
  assert.equal(result, null);
});

test("computePunctuality is null without a configured start time", () => {
  const result = computePunctuality(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T10:00:00.000Z") },
    { workingDays: [1, 2, 3, 4, 5] }
  );
  assert.equal(result, null);
});

test("computePunctuality marks ON_TIME when clock-in is at or before the start", () => {
  const result = computePunctuality(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T08:00:00.000Z") },
    { workingDays: [1, 2, 3, 4, 5], workingStartTime: "08:00" }
  );
  assert.equal(result, "ON_TIME");
});

test("computePunctuality marks LATE when clock-in is after the start", () => {
  const result = computePunctuality(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T08:01:00.000Z") },
    { workingDays: [1, 2, 3, 4, 5], workingStartTime: "08:00" }
  );
  assert.equal(result, "LATE");
});

test("computePunctuality compares in the company timezone offset", () => {
  // Clock-in at 00:30Z equals 07:30 in a +7h company timezone: on time.
  const result = computePunctuality(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T00:30:00.000Z") },
    { workingDays: [1, 2, 3, 4, 5], workingStartTime: "08:00" },
    7 * 60 * 60 * 1000
  );
  assert.equal(result, "ON_TIME");
});

test("validateWorkSchedule rejects invalid day sets and times", () => {
  assert.throws(() => validateWorkSchedule({ workingDays: [] }), ValidationError);
  assert.throws(() => validateWorkSchedule({ workingDays: [7] }), ValidationError);
  assert.throws(() => validateWorkSchedule({ workingStartTime: "8am" }), ValidationError);
  assert.throws(
    () => validateWorkSchedule({ workingStartTime: "09:00", workingEndTime: "08:00" }),
    ValidationError
  );
});

test("validateWorkSchedule normalizes valid input", () => {
  const result = validateWorkSchedule({
    workingDays: [5, 1, 1, 4],
    workingStartTime: "08:00",
    workingEndTime: "17:00",
  });
  assert.deepEqual(result.workingDays, [5, 1, 4]);
  assert.equal(result.workingStartTime, "08:00");
  assert.equal(result.workingEndTime, "17:00");
});
