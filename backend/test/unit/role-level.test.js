/**
 * Role-level domain tests (FR-064).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLE_DATA_SCOPES,
  isHigherLevel,
  defaultScopeForLevel,
  validateRoleLevel,
} = require("../../src/domain/role-level");

test("ROLE_DATA_SCOPES lists the five explicit scopes", () => {
  assert.deepEqual(ROLE_DATA_SCOPES, [
    "SELF",
    "DIRECT_SUBORDINATES",
    "DIRECT_AND_INDIRECT_SUBORDINATES",
    "DEPARTMENT",
    "ALL_EMPLOYEES",
  ]);
});

test("isHigherLevel compares numeric levels (higher = higher)", () => {
  assert.equal(isHigherLevel(80, 50), true);
  assert.equal(isHigherLevel(50, 80), false);
  assert.equal(isHigherLevel(100, 100), false);
});

test("defaultScopeForLevel suggests scopes per level band", () => {
  assert.equal(defaultScopeForLevel(10), "SELF");
  assert.equal(defaultScopeForLevel(50), "DIRECT_SUBORDINATES");
  assert.equal(defaultScopeForLevel(80), "DEPARTMENT");
  assert.equal(defaultScopeForLevel(100), "ALL_EMPLOYEES");
});

test("validateRoleLevel accepts valid inputs and normalizes the label", () => {
  const result = validateRoleLevel({ level: 42, levelLabel: "  Reviewer  ", dataScope: "DEPARTMENT" });
  assert.equal(result.level, 42);
  assert.equal(result.levelLabel, "Reviewer");
  assert.equal(result.dataScope, "DEPARTMENT");
});

test("validateRoleLevel applies defaults when omitted", () => {
  const result = validateRoleLevel({});
  assert.equal(result.level, 10);
  assert.equal(result.dataScope, "SELF");
});

test("validateRoleLevel rejects out-of-range levels", () => {
  assert.throws(() => validateRoleLevel({ level: 0 }), /between 1 and 1000/);
  assert.throws(() => validateRoleLevel({ level: 1001 }), /between 1 and 1000/);
  assert.throws(() => validateRoleLevel({ level: 1.5 }), /between 1 and 1000/);
});

test("validateRoleLevel rejects an unknown data scope", () => {
  assert.throws(() => validateRoleLevel({ dataScope: "EVERYONE" }), /Data scope/);
});
