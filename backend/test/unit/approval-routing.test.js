/**
 * Approval routing domain tests (FR-042): default rules, rule validation,
 * chain evaluation with fallback, multi-level ordering, and self-approval.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  SOURCE_MANAGER_OF_REQUESTER,
  FALLBACK_ACTIVE_HR_ADMIN,
  FALLBACK_SUPER_ADMIN,
  defaultRules,
  validateRoutingRule,
  evaluateChain,
  hasMoreLevels,
} = require("../../src/domain/approval-routing");
const { assertNoSelfApproval } = require("../../src/domain/request");
const { ValidationError, ConflictError } = require("../../src/domain/errors");

test("defaultRules provides a single-level manager rule per request type", () => {
  const rules = defaultRules();
  for (const type of ["LEAVE", "OVERTIME", "TRIP"]) {
    assert.ok(rules[type], `rule exists for ${type}`);
    assert.equal(rules[type].requestType, type);
    assert.deepEqual(rules[type].levels, [{ source: SOURCE_MANAGER_OF_REQUESTER }]);
    assert.equal(rules[type].fallback, FALLBACK_ACTIVE_HR_ADMIN);
    assert.equal(rules[type].enabled, true);
  }
});

test("validateRoutingRule accepts a valid rule and normalizes it", () => {
  const rule = validateRoutingRule({
    requestType: "LEAVE",
    levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }],
    fallback: FALLBACK_ACTIVE_HR_ADMIN,
    enabled: true,
  });
  assert.equal(rule.requestType, "LEAVE");
  assert.equal(rule.enabled, true);
});

test("validateRoutingRule rejects malformed rules (F1)", () => {
  assert.throws(
    () => validateRoutingRule({ requestType: "PAYROLL", levels: [], fallback: "ACTIVE_HR_ADMIN", enabled: true }),
    ValidationError
  );
  assert.throws(
    () => validateRoutingRule({ requestType: "LEAVE", levels: [], fallback: "ACTIVE_HR_ADMIN", enabled: true }),
    ValidationError
  );
  assert.throws(
    () => validateRoutingRule({ requestType: "LEAVE", levels: [{ source: "DEPARTMENT_HEAD" }], fallback: "ACTIVE_HR_ADMIN", enabled: true }),
    ValidationError
  );
  assert.throws(
    () => validateRoutingRule({ requestType: "LEAVE", levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }], fallback: "CEO", enabled: true }),
    ValidationError
  );
});

test("evaluateChain resolves the manager source and skips missing approvers", async () => {
  const rule = { levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }], fallback: FALLBACK_ACTIVE_HR_ADMIN };
  const chain = await evaluateChain(
    rule,
    async () => "u_mgr",
    "u_fallback"
  );
  assert.deepEqual(chain, ["u_mgr"]);

  const noManager = await evaluateChain(rule, async () => null, "u_fallback");
  assert.deepEqual(noManager, ["u_fallback"], "fallback used when no primary approver");
});

test("evaluateChain orders the single approval level and omits missing approvers", async () => {
  const rule = { levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }], fallback: FALLBACK_ACTIVE_HR_ADMIN };
  let call = 0;
  const chain = await evaluateChain(
    rule,
    async () => {
      call += 1;
      return call === 1 ? "u_1" : null;
    },
    "u_fallback"
  );
  assert.deepEqual(chain, ["u_1"]);
});

test("validateRoutingRule rejects multi-level chains (FR-063 single-approver)", () => {
  assert.throws(
    () =>
      validateRoutingRule({
        requestType: "LEAVE",
        levels: [
          { source: SOURCE_MANAGER_OF_REQUESTER },
          { source: SOURCE_MANAGER_OF_REQUESTER },
        ],
        fallback: FALLBACK_ACTIVE_HR_ADMIN,
        enabled: true,
      }),
    (err) => err instanceof ValidationError && /exactly one approval level/.test(err.message)
  );
});

test("hasMoreLevels is false for a single-level chain (FR-063)", () => {
  const chain = ["a"];
  assert.equal(hasMoreLevels(chain, 0), false);
  assert.equal(hasMoreLevels(["a", "b"], 0), true, "legacy helper retained for history");
});

test("assertNoSelfApproval blocks deciding your own request (F2)", () => {
  assert.doesNotThrow(() => assertNoSelfApproval("u_emp", "u_mgr"));
  assert.throws(
    () => assertNoSelfApproval("u_emp", "u_emp"),
    (err) => err instanceof ConflictError && err.code === "SELF_APPROVAL_DENIED"
  );
});
