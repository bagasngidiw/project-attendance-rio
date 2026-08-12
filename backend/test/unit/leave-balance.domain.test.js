/**
 * Leave balance domain tests (FR-022): balance computation, adjustment
 * validation, year validation, and submission gating.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeBalance,
  assertYear,
  validateAdjustment,
  canSubmit,
} = require("../../src/domain/leave-balance");
const { ValidationError } = require("../../src/domain/errors");

test("computeBalance derives available days from the four counters", () => {
  assert.equal(
    computeBalance({ entitlementDays: 20, adjustmentDays: 2, consumedDays: 5, reservedDays: 3 }),
    14
  );
  assert.equal(computeBalance({ entitlementDays: 20 }), 20);
  assert.equal(computeBalance({}), 0);
  assert.equal(computeBalance(), 0);
});

test("computeBalance coerces non-finite counters to zero", () => {
  assert.equal(
    computeBalance({ entitlementDays: "20", adjustmentDays: null, consumedDays: undefined }),
    20
  );
  assert.equal(computeBalance({ entitlementDays: NaN }), 0);
});

test("computeBalance can produce a negative available balance", () => {
  assert.equal(
    computeBalance({ entitlementDays: 10, consumedDays: 12 }),
    -2
  );
});

test("assertYear accepts integers of 2000 or later", () => {
  assert.equal(assertYear(2026), 2026);
  assert.equal(assertYear("2026"), 2026);
  assert.equal(assertYear(2000), 2000);
});

test("assertYear rejects invalid years", () => {
  for (const bad of [1999, 2026.5, NaN, "nope", undefined, null]) {
    assert.throws(
      () => assertYear(bad),
      (err) => err instanceof ValidationError && err.details.field === "year"
    );
  }
});

test("validateAdjustment accepts a valid adjustment", () => {
  assert.doesNotThrow(() =>
    validateAdjustment({ deltaDays: 3, reason: "Compensation adjustment", year: 2026 })
  );
  assert.doesNotThrow(() =>
    validateAdjustment({ deltaDays: -1.5, reason: "Recoup", year: 2026 })
  );
});

test("validateAdjustment rejects a zero or non-finite deltaDays", () => {
  for (const bad of [0, NaN, Infinity, "2"]) {
    assert.throws(
      () => validateAdjustment({ deltaDays: bad, reason: "r", year: 2026 }),
      (err) => err instanceof ValidationError && err.details.field === "deltaDays"
    );
  }
});

test("validateAdjustment requires a reason", () => {
  for (const reason of [undefined, "", "   "]) {
    assert.throws(
      () => validateAdjustment({ deltaDays: 1, reason, year: 2026 }),
      (err) => err instanceof ValidationError && err.details.field === "reason"
    );
  }
});

test("validateAdjustment rejects an invalid year", () => {
  assert.throws(
    () => validateAdjustment({ deltaDays: 1, reason: "r", year: 1999 }),
    (err) => err instanceof ValidationError && err.details.field === "year"
  );
});

test("canSubmit gates a submission against the available balance", () => {
  assert.deepEqual(canSubmit({ balance: 10, requestedDays: 5 }), {
    balance: 10,
    requestedDays: 5,
    canSubmit: true,
    wouldExceedBalance: false,
  });
  assert.deepEqual(canSubmit({ balance: 10, requestedDays: 10 }), {
    balance: 10,
    requestedDays: 10,
    canSubmit: true,
    wouldExceedBalance: false,
  });
  assert.deepEqual(canSubmit({ balance: 10, requestedDays: 11 }), {
    balance: 10,
    requestedDays: 11,
    canSubmit: false,
    wouldExceedBalance: true,
  });
  assert.equal(canSubmit({}).canSubmit, true);
});
