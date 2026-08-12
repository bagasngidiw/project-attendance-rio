/**
 * Timezone helper tests (FR-060): UTC instant <-> company work day
 * conversion and offset-range validation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  toWorkDay,
  fromWorkDay,
  assertTimezoneOffsetMs,
  MIN_TIMEZONE_OFFSET_MS,
  MAX_TIMEZONE_OFFSET_MS,
} = require("../../src/domain/timezone.helper");
const { ValidationError } = require("../../src/domain/errors");

test("toWorkDay maps a UTC instant to the company work day", () => {
  assert.equal(toWorkDay("2026-08-06T00:30:00.000Z", 0), "2026-08-06");
  assert.equal(toWorkDay(new Date("2026-08-06T12:00:00.000Z"), 0), "2026-08-06");
});

test("toWorkDay shifts the work day by the company offset", () => {
  const offset = 7 * 60 * 60 * 1000;
  // 2026-08-05T20:00Z is still the 6th in UTC+7.
  assert.equal(toWorkDay("2026-08-05T20:00:00.000Z", offset), "2026-08-06");
  // 2026-08-05T16:59:59Z is the 5th in UTC+7.
  assert.equal(toWorkDay("2026-08-05T16:59:59.000Z", offset), "2026-08-05");
  // Negative offset: 05:00Z is 23:00 local the prior day in UTC-6.
  assert.equal(toWorkDay("2026-08-06T05:00:00.000Z", -6 * 60 * 60 * 1000), "2026-08-05");
  assert.equal(toWorkDay("2026-08-06T06:00:00.000Z", -6 * 60 * 60 * 1000), "2026-08-06");
});

test("toWorkDay rejects an invalid instant or offset", () => {
  assert.throws(() => toWorkDay("garbage", 0), ValidationError);
  assert.throws(() => toWorkDay("2026-08-06T00:00:00Z", "7h"), ValidationError);
  assert.throws(() => toWorkDay("2026-08-06T00:00:00Z", NaN), ValidationError);
});

test("fromWorkDay returns the UTC instant of local midnight", () => {
  assert.equal(fromWorkDay("2026-08-06", 0).toISOString(), "2026-08-06T00:00:00.000Z");
  const offset = 7 * 60 * 60 * 1000;
  assert.equal(
    fromWorkDay("2026-08-06", offset).toISOString(),
    "2026-08-05T17:00:00.000Z"
  );
  const negative = -5 * 60 * 60 * 1000;
  assert.equal(
    fromWorkDay("2026-08-06", negative).toISOString(),
    "2026-08-06T05:00:00.000Z"
  );
});

test("toWorkDay and fromWorkDay round-trip", () => {
  for (const offset of [0, 7 * 3600e3, -6 * 3600e3, 14 * 3600e3, -12 * 3600e3]) {
    assert.equal(toWorkDay(fromWorkDay("2026-09-01", offset), offset), "2026-09-01");
  }
});

test("fromWorkDay validates the date key", () => {
  assert.throws(() => fromWorkDay("2026-02-30", 0), ValidationError);
  assert.throws(() => fromWorkDay("9/1/2026", 0), ValidationError);
  assert.throws(() => fromWorkDay("2026-08-06T00:00:00Z", 0), ValidationError);
});

test("fromWorkDay validates the offset range", () => {
  assert.throws(() => fromWorkDay("2026-08-06", MAX_TIMEZONE_OFFSET_MS + 1), ValidationError);
  assert.throws(() => fromWorkDay("2026-08-06", MIN_TIMEZONE_OFFSET_MS - 1), ValidationError);
});

test("assertTimezoneOffsetMs enforces UTC-12..UTC+14 bounds", () => {
  assert.doesNotThrow(() => assertTimezoneOffsetMs(0));
  assert.doesNotThrow(() => assertTimezoneOffsetMs(MIN_TIMEZONE_OFFSET_MS));
  assert.doesNotThrow(() => assertTimezoneOffsetMs(MAX_TIMEZONE_OFFSET_MS));
  assert.throws(() => assertTimezoneOffsetMs(MIN_TIMEZONE_OFFSET_MS - 1), ValidationError);
  assert.throws(() => assertTimezoneOffsetMs(MAX_TIMEZONE_OFFSET_MS + 1), ValidationError);
  assert.throws(() => assertTimezoneOffsetMs("0"), ValidationError);
  assert.throws(() => assertTimezoneOffsetMs(undefined), ValidationError);
});
