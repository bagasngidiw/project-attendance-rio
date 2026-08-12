/**
 * Approval-policy domain tests (FR-063): single-approver invariant, cutoff
 * evaluation, escalation eligibility, decision-comment normalization.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertSingleApprover,
  normalizeCutoffRule,
  isApprovalBlocked,
  canEscalate,
  normalizeDecisionComment,
  DEFAULT_ESCALATION_POLICY,
} = require("../../src/domain/approval-policy");

test("assertSingleApprover accepts exactly one level", () => {
  const rule = { levels: [{ source: "MANAGER_OF_REQUESTER" }] };
  assert.doesNotThrow(() => assertSingleApprover(rule));
});

test("assertSingleApprover rejects empty and multi-level chains", () => {
  assert.throws(() => assertSingleApprover({ levels: [] }), /exactly one approval level/);
  assert.throws(
    () => assertSingleApprover({ levels: [{}, {}] }),
    /exactly one approval level/
  );
});

test("normalizeCutoffRule applies defaults and dedupes weekday lists", () => {
  const rule = normalizeCutoffRule({ requestType: "LEAVE", days: [1, 1, 7, 3] });
  assert.deepEqual(rule.days, [1, 3]);
  assert.equal(rule.enabled, true);
  assert.equal(rule.fromTime, "");
});

test("isApprovalBlocked passes when the rule is disabled or absent", () => {
  assert.deepEqual(isApprovalBlocked({}, new Date(), null), { blocked: false });
  assert.deepEqual(
    isApprovalBlocked({}, new Date(), normalizeCutoffRule({ enabled: false })),
    { blocked: false }
  );
});

test("isApprovalBlocked blocks on disallowed weekdays", () => {
  // 2026-08-07 is a Friday (day 5).
  const friday = new Date("2026-08-07T12:00:00Z");
  const rule = normalizeCutoffRule({ days: [0, 6] }); // only weekends allowed
  const result = isApprovalBlocked({}, friday, rule);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /weekdays/);
});

test("isApprovalBlocked passes on allowed weekdays", () => {
  const friday = new Date("2026-08-07T12:00:00Z");
  const rule = normalizeCutoffRule({ days: [5] });
  assert.equal(isApprovalBlocked({}, friday, rule).blocked, false);
});

test("isApprovalBlocked honors the time window", () => {
  const morning = new Date("2026-08-07T09:00:00Z");
  const rule = normalizeCutoffRule({ fromTime: "08:00", toTime: "17:00" });
  assert.equal(isApprovalBlocked({}, morning, rule).blocked, false);

  const night = new Date("2026-08-07T22:00:00Z");
  const blocked = isApprovalBlocked({}, night, rule);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason, /between 08:00 and 17:00/);
});

test("isApprovalBlocked consults the business calendar", () => {
  const calendar = { isWorkingDay: () => false };
  const rule = normalizeCutoffRule({ enabled: true });
  const result = isApprovalBlocked({}, new Date(), rule, calendar);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /working day/);
});

test("canEscalate only allows PENDING requests", () => {
  assert.deepEqual(canEscalate({ status: "PENDING" }, DEFAULT_ESCALATION_POLICY), {
    canEscalate: true,
  });
  assert.equal(canEscalate({ status: "APPROVED" }, DEFAULT_ESCALATION_POLICY).canEscalate, false);
  assert.equal(canEscalate(null, DEFAULT_ESCALATION_POLICY).canEscalate, false);
  assert.equal(
    canEscalate({ status: "PENDING" }, { allowEscalation: false, escalationRateLimit: {} }).canEscalate,
    false
  );
});

test("normalizeDecisionComment trims and allows blank (FR-063 U.6)", () => {
  assert.equal(normalizeDecisionComment("  Nope  "), "Nope");
  assert.equal(normalizeDecisionComment(""), "");
  assert.equal(normalizeDecisionComment(undefined), "");
  assert.equal(normalizeDecisionComment(null), "");
});
