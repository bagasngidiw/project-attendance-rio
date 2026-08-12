/**
 * Delegation domain tests (FR-009) — pure validation + coverage logic.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateDelegation,
  delegationCovers,
  DELEGATION_STATUS,
} = require("../../src/domain/delegation");
const { ValidationError } = require("../../src/domain/errors");

function validInput(overrides = {}) {
  return {
    delegatorId: "u_mgr",
    delegateId: "u_delegate",
    requestTypes: [],
    startsAt: "2026-09-01",
    endsAt: "2026-09-30",
    ...overrides,
  };
}

test("delegation domain: validateDelegation returns a normalized shape for a valid delegation", () => {
  const result = validateDelegation(validInput());
  assert.equal(result.delegatorId, "u_mgr");
  assert.equal(result.delegateId, "u_delegate");
  assert.deepEqual(result.requestTypes, []);
  assert.ok(result.startsAt instanceof Date);
  assert.ok(result.endsAt instanceof Date);
});

test("delegation domain: validateDelegation lower-cases and dedupes requestTypes", () => {
  const result = validateDelegation(validInput({ requestTypes: ["LEAVE", "overtime", "Leave"] }));
  assert.deepEqual(result.requestTypes, ["leave", "overtime"]);
});

test("delegation domain: self-delegation is rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ delegateId: "u_mgr" }), { isSamePerson: true }),
    (err) => err instanceof ValidationError && err.details.field === "delegateId"
  );
  assert.throws(
    () => validateDelegation(validInput({ delegateId: "u_mgr" })),
    (err) => err instanceof ValidationError && err.details.field === "delegateId"
  );
});

test("delegation domain: inactive delegate is rejected", () => {
  assert.throws(
    () => validateDelegation(validInput(), { delegateIsActive: false }),
    (err) => err instanceof ValidationError && err.details.field === "delegateId"
  );
});

test("delegation domain: missing delegator or delegate is rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ delegatorId: undefined })),
    ValidationError
  );
  assert.throws(
    () => validateDelegation(validInput({ delegateId: undefined })),
    ValidationError
  );
});

test("delegation domain: inverted dates are rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ startsAt: "2026-09-30", endsAt: "2026-09-01" })),
    (err) => err instanceof ValidationError && err.details.field === "endsAt"
  );
});

test("delegation domain: equal dates are rejected (endsAt must be strictly after startsAt)", () => {
  assert.throws(
    () => validateDelegation(validInput({ startsAt: "2026-09-01", endsAt: "2026-09-01" })),
    (err) => err instanceof ValidationError && err.details.field === "endsAt"
  );
});

test("delegation domain: invalid dates are rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ startsAt: "not-a-date" })),
    (err) => err instanceof ValidationError && err.details.field === "startsAt"
  );
  assert.throws(
    () => validateDelegation(validInput({ endsAt: "not-a-date" })),
    (err) => err instanceof ValidationError && err.details.field === "endsAt"
  );
});

test("delegation domain: non-array requestTypes is rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ requestTypes: "leave" })),
    (err) => err instanceof ValidationError && err.details.field === "requestTypes"
  );
});

test("delegation domain: requestTypes outside the allowed set are rejected", () => {
  assert.throws(
    () => validateDelegation(validInput({ requestTypes: ["leave", "salary"] })),
    (err) => err instanceof ValidationError && err.details.field === "requestTypes"
  );
});

const ACTIVE = { status: DELEGATION_STATUS.ACTIVE, startsAt: "2026-09-01", endsAt: "2026-09-30", requestTypes: [] };

test("delegation domain: delegationCovers true when ACTIVE, in window, all types", () => {
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "2026-09-15" }), true);
});

test("delegation domain: delegationCovers window boundaries are inclusive", () => {
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "2026-09-01" }), true);
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "2026-09-30" }), true);
});

test("delegation domain: delegationCovers false outside the window", () => {
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "2026-08-31" }), false);
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "2026-10-01" }), false);
});

test("delegation domain: delegationCovers false for revoked delegations", () => {
  assert.equal(
    delegationCovers({ ...ACTIVE, status: DELEGATION_STATUS.REVOKED }, { requestType: "leave", date: "2026-09-15" }),
    false
  );
});

test("delegation domain: delegationCovers filters by request type", () => {
  const leaveOnly = { ...ACTIVE, requestTypes: ["leave"] };
  assert.equal(delegationCovers(leaveOnly, { requestType: "leave", date: "2026-09-15" }), true);
  assert.equal(delegationCovers(leaveOnly, { requestType: "overtime", date: "2026-09-15" }), false);
});

test("delegation domain: delegationCovers is case-insensitive for request type", () => {
  const leaveOnly = { ...ACTIVE, requestTypes: ["leave"] };
  assert.equal(delegationCovers(leaveOnly, { requestType: "LEAVE", date: "2026-09-15" }), true);
});

test("delegation domain: delegationCovers false for invalid date input", () => {
  assert.equal(delegationCovers(ACTIVE, { requestType: "leave", date: "garbage" }), false);
  assert.equal(delegationCovers(null, { requestType: "leave", date: "2026-09-15" }), false);
});

test("delegation domain: delegationCovers defaults to today when no date given", () => {
  assert.equal(delegationCovers({ status: "ACTIVE", startsAt: "2000-01-01", endsAt: "2100-01-01", requestTypes: [] }, {}), true);
});
