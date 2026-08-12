/**
 * RBAC console invariant tests (FR-011 §3.4): system-role protection,
 * SUPER_ADMIN guard, permission-key validation, diff computation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validatePermissionKeys,
  assertSystemRoleAllowed,
  assertSuperAdminPermissionsSafe,
  assertRoleHasPermissions,
  computePermissionDiff,
  validateRoleCreateInput,
  PLATFORM_ADMIN_PERMISSIONS,
} = require("../../src/domain/rbac-admin-rules");
const { ValidationError, ConflictError } = require("../../src/domain/errors");

test("validatePermissionKeys rejects unknown keys and dedupes", () => {
  assert.deepEqual(
    validatePermissionKeys(["leave:submit", "leave:submit", "dashboard:view"]),
    ["leave:submit", "dashboard:view"]
  );
  assert.throws(() => validatePermissionKeys(["not:real"]), /Unknown permission/);
});

test("system roles cannot be disabled", () => {
  assert.throws(
    () => assertSystemRoleAllowed({ key: "EMPLOYEE", isSystem: true }, "disable"),
    ConflictError
  );
});

test("non-system roles can be disabled", () => {
  assert.doesNotThrow(() =>
    assertSystemRoleAllowed({ key: "PAYROLL_SPECIALIST", isSystem: false }, "disable")
  );
});

test("SUPER_ADMIN cannot lose platform-admin permissions", () => {
  const role = { key: "SUPER_ADMIN" };
  assert.throws(
    () => assertSuperAdminPermissionsSafe(role, ["dashboard:view"]),
    ConflictError
  );
  // Keeping platform perms is fine.
  assert.doesNotThrow(() =>
    assertSuperAdminPermissionsSafe(role, [...PLATFORM_ADMIN_PERMISSIONS, "dashboard:view"])
  );
});

test("SUPER_ADMIN guard does not apply to other roles", () => {
  assert.doesNotThrow(() =>
    assertSuperAdminPermissionsSafe({ key: "HR_ADMIN" }, ["dashboard:view"])
  );
});

test("roles must have at least one permission", () => {
  assert.throws(() => assertRoleHasPermissions([]), ValidationError);
  assert.throws(() => assertRoleHasPermissions(undefined), ValidationError);
  assert.doesNotThrow(() => assertRoleHasPermissions(["dashboard:view"]));
});

test("computePermissionDiff returns added and removed sets", () => {
  assert.deepEqual(
    computePermissionDiff(["a:view", "b:view"], ["a:view", "c:submit"]),
    { added: ["c:submit"], removed: ["b:view"] }
  );
});

test("validateRoleCreateInput validates and normalizes", () => {
  const result = validateRoleCreateInput({
    key: "payroll specialist",
    name: "Payroll Specialist",
    permissions: ["reporting:view"],
  });
  assert.equal(result.key, "PAYROLL_SPECIALIST");
  assert.equal(result.name, "Payroll Specialist");

  assert.throws(
    () => validateRoleCreateInput({ key: "X", name: "X", permissions: [] }),
    ValidationError
  );
});

test("platform admin permission set contains the guarded keys", () => {
  for (const key of [
    "rbac:manage_roles",
    "rbac:manage_permissions",
    "audit:view",
    "platform:settings",
  ]) {
    assert.ok(PLATFORM_ADMIN_PERMISSIONS.includes(key), `missing ${key}`);
  }
});
