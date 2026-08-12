/**
 * Request domain tests (FR-016 / FR-036 / FR-054): lifecycle transition
 * matrix, cancel-only-while-pending rule, and per-type payload validation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUEST_STATUS,
  assertValidTransition,
  assertCancelAllowed,
  isTerminal,
  validateLeavePayload,
  validateOvertimePayload,
  validateTripPayload,
} = require("../../src/domain/request");
const { ConflictError, ValidationError } = require("../../src/domain/errors");

test("submit moves DRAFT to PENDING", () => {
  assert.doesNotThrow(() => assertValidTransition(REQUEST_STATUS.DRAFT, REQUEST_STATUS.PENDING));
});

test("pending accepts approve/reject/cancel", () => {
  for (const to of ["APPROVED", "REJECTED", "CANCELLED"]) {
    assert.doesNotThrow(() => assertValidTransition(REQUEST_STATUS.PENDING, to));
  }
});

test("decided states are terminal", () => {
  assert.equal(isTerminal(REQUEST_STATUS.APPROVED), true);
  assert.equal(isTerminal(REQUEST_STATUS.REJECTED), true);
  assert.equal(isTerminal(REQUEST_STATUS.CANCELLED), true);
  assert.equal(isTerminal(REQUEST_STATUS.PENDING), false);
  assert.equal(isTerminal(REQUEST_STATUS.DRAFT), false);
});

test("invalid transitions are rejected with INVALID_STATUS_TRANSITION", () => {
  assert.throws(
    () => assertValidTransition(REQUEST_STATUS.DRAFT, "APPROVED"),
    (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
  );
  assert.throws(
    () => assertValidTransition(REQUEST_STATUS.APPROVED, "CANCELLED"),
    (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
  );
  assert.throws(
    () => assertValidTransition(REQUEST_STATUS.CANCELLED, "PENDING"),
    (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
  );
});

test("cancellation is allowed only while PENDING (F1)", () => {
  assert.doesNotThrow(() => assertCancelAllowed(REQUEST_STATUS.PENDING));
  for (const status of ["DRAFT", "APPROVED", "REJECTED", "CANCELLED"]) {
    assert.throws(
      () => assertCancelAllowed(status),
      (err) => err instanceof ConflictError && err.code === "INVALID_STATUS_TRANSITION"
    );
  }
});

test("leave payload validation accepts a valid request (F2)", () => {
  assert.doesNotThrow(() =>
    validateLeavePayload({
      leaveType: "ANNUAL",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      reason: "Family vacation",
    })
  );
});

test("leave payload validation rejects missing type, inverted dates, missing reason (F2)", () => {
  // FR-058: the domain requires a non-empty leave type; registration against
  // the configured types is enforced by the application layer.
  assert.throws(
    () => validateLeavePayload({ leaveType: "", startDate: "2026-09-01", endDate: "2026-09-03", reason: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "leaveType"
  );
  assert.throws(
    () => validateLeavePayload({ leaveType: "ANNUAL", startDate: "2026-09-05", endDate: "2026-09-01", reason: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
  assert.throws(
    () => validateLeavePayload({ leaveType: "SICK", startDate: "2026-09-01", endDate: "2026-09-01" }),
    ValidationError
  );
  assert.doesNotThrow(() =>
    validateLeavePayload({ leaveType: "CUSTOM_TYPE", startDate: "2026-09-01", endDate: "2026-09-02", reason: "x" })
  );
});

test("overtime payload validation enforces time range", () => {
  assert.doesNotThrow(() =>
    validateOvertimePayload({ date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "Catch-up" })
  );
  assert.throws(
    () => validateOvertimePayload({ date: "2026-09-10", startTime: "21:00", endTime: "18:00", reason: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "endTime"
  );
  assert.throws(
    () => validateOvertimePayload({ date: "2026-09-10", startTime: "9:00", endTime: "21:00", reason: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "startTime"
  );
  assert.throws(
    () => validateOvertimePayload({ date: "2026-09-10", startTime: "18:00", endTime: "21:00" }),
    ValidationError
  );
});

test("trip payload validation requires destination + valid date range", () => {
  assert.doesNotThrow(() =>
    validateTripPayload({ destination: "Singapore", startDate: "2026-10-01", endDate: "2026-10-05", purpose: "Client visit" })
  );
  assert.throws(
    () => validateTripPayload({ destination: "", startDate: "2026-10-01", endDate: "2026-10-05", purpose: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "destination"
  );
  assert.throws(
    () => validateTripPayload({ destination: "Singapore", startDate: "2026-10-05", endDate: "2026-10-01", purpose: "x" }),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
  assert.throws(
    () => validateTripPayload({ destination: "Singapore", startDate: "2026-10-01", endDate: "2026-10-05" }),
    ValidationError
  );
});
