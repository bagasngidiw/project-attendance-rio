/**
 * Attendance domain tests (FR-035 / FR-020 / FR-041): clock rules, exception
 * classification, correction rules, and date normalization.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  toWorkDay,
  computeExceptions,
  computeStatus,
  assertClockInAllowed,
  assertClockOutAllowed,
  assertClockOutAfterIn,
  assertSelfCorrectionDenied,
  assertCorrectionReason,
} = require("../../src/domain/attendance");
const { ValidationError, ConflictError } = require("../../src/domain/errors");

test("toWorkDay derives the company-timezone work day from a UTC instant", () => {
  const instant = new Date("2026-08-06T00:30:00.000Z");
  assert.equal(toWorkDay(instant, 0), "2026-08-06");
  // With a +7h company offset the previous UTC evening belongs to the 6th.
  assert.equal(toWorkDay(new Date("2026-08-05T20:00:00.000Z"), 7 * 60 * 60 * 1000), "2026-08-06");
});

test("clock-in is blocked when a work period already exists for the day (F1)", () => {
  assert.doesNotThrow(() => assertClockInAllowed(null));
  assert.throws(
    () => assertClockInAllowed({ clockOutAt: null }),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );
  assert.throws(
    () => assertClockInAllowed({ clockOutAt: new Date() }),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );
});

test("clock-out is blocked without an open period (F1)", () => {
  assert.throws(
    () => assertClockOutAllowed(null),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );
  assert.throws(
    () => assertClockOutAllowed({ clockOutAt: new Date() }),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );
  assert.doesNotThrow(() => assertClockOutAllowed({ clockOutAt: null }));
});

test("clock-out must be after clock-in (F1)", () => {
  const inAt = new Date("2026-08-06T08:00:00Z");
  assert.throws(
    () => assertClockOutAfterIn(inAt, new Date("2026-08-06T07:59:59Z")),
    ValidationError
  );
  assert.doesNotThrow(() => assertClockOutAfterIn(inAt, new Date("2026-08-06T17:00:00Z")));
});

test("a completed same-day shift is NORMAL (F2)", () => {
  const types = computeExceptions(
    {
      date: "2026-08-06",
      clockInAt: new Date("2026-08-06T08:00:00Z"),
      clockOutAt: new Date("2026-08-06T17:00:00Z"),
    },
    new Date("2026-08-06T18:00:00Z")
  );
  assert.deepEqual(types, []);
  assert.equal(computeStatus(types), "NORMAL");
});

test("an open shift after the work day ended is MISSING_CLOCK_OUT (F2)", () => {
  const types = computeExceptions(
    { date: "2026-08-05", clockInAt: new Date("2026-08-05T08:00:00Z"), clockOutAt: null },
    new Date("2026-08-06T09:00:00Z")
  );
  assert.deepEqual(types, ["MISSING_CLOCK_OUT"]);
  assert.equal(computeStatus(types), "EXCEPTION");
});

test("an open shift TODAY is not yet an exception", () => {
  const types = computeExceptions(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T08:00:00Z"), clockOutAt: null },
    new Date("2026-08-06T09:00:00Z")
  );
  assert.deepEqual(types, []);
});

test("a clock-out without a clock-in is MISSING_CLOCK_IN (F2)", () => {
  const types = computeExceptions(
    { date: "2026-08-06", clockInAt: null, clockOutAt: new Date("2026-08-06T17:00:00Z") },
    new Date("2026-08-06T18:00:00Z")
  );
  assert.deepEqual(types, ["MISSING_CLOCK_IN"]);
});

test("shifts outside 1-16h bounds are ANOMALY (F2)", () => {
  const short = computeExceptions(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T08:00:00Z"), clockOutAt: new Date("2026-08-06T08:30:00Z") },
    new Date("2026-08-06T09:00:00Z")
  );
  assert.ok(short.includes("ANOMALY"));

  const long = computeExceptions(
    { date: "2026-08-06", clockInAt: new Date("2026-08-06T08:00:00Z"), clockOutAt: new Date("2026-08-07T01:00:00Z") },
    new Date("2026-08-07T02:00:00Z")
  );
  assert.ok(long.includes("ANOMALY"));
});

test("self-correction is denied (F3)", () => {
  assert.doesNotThrow(() => assertSelfCorrectionDenied("u_emp", "u_hr"));
  assert.throws(
    () => assertSelfCorrectionDenied("u_emp", "u_emp"),
    (err) => err instanceof ConflictError && err.code === "SELF_CORRECTION_DENIED"
  );
});

test("a correction reason is required (F3)", () => {
  assert.throws(
    () => assertCorrectionReason(""),
    (err) => err instanceof ValidationError && err.details.field === "reason"
  );
  assert.doesNotThrow(() => assertCorrectionReason("System delay at clock-in."));
});
