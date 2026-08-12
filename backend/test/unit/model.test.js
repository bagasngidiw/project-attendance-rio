/**
 * Domain tests: value objects and effective-permission resolution (FR-002).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  Email,
  PermissionKey,
  EffectivePermissions,
  computeEffectivePermissions,
  assertSuperAdminSafe,
  validateRoleInput,
  isWithinTeamScope,
  assertValidManagerAssignment,
} = require("../../src/domain/model");
const { ValidationError } = require("../../src/domain/errors");

test("Email normalizes and validates", () => {
  assert.equal(new Email("  Jane@Corp.IO ").toString(), "jane@corp.io");
  assert.throws(() => new Email("not-an-email"), ValidationError);
  assert.throws(() => new Email(""), ValidationError);
  assert.ok(new Email("a@b.co").equals(new Email("A@B.CO")));
});

test("PermissionKey rejects unknown keys", () => {
  assert.equal(new PermissionKey("leave:approve").key, "leave:approve");
  assert.equal(new PermissionKey("leave:approve").module, "LEAVE");
  assert.throws(() => new PermissionKey("bogus:key"), ValidationError);
});

test("EffectivePermissions dedupes and validates", () => {
  const perms = new EffectivePermissions([
    "attendance:clock_in",
    "leave:view_own",
    "attendance:clock_in",
  ]);
  assert.deepEqual(perms.toArray(), ["attendance:clock_in", "leave:view_own"]);
  assert.ok(perms.has("attendance:clock_in"));
  assert.equal(perms.has("leave:approve"), false);
  assert.throws(() => new EffectivePermissions(["unknown:key"]), ValidationError);
});

test("EffectivePermissions wildcard grants all", () => {
  const perms = new EffectivePermissions(["*"]);
  assert.ok(perms.has("rbac:manage_roles"));
});

test("computeEffectivePermissions unions across roles and skips disabled", () => {
  const result = computeEffectivePermissions([
    { roleKey: "A", status: "ACTIVE", permissionKeys: ["x:one", "y:two"] },
    { roleKey: "B", status: "ACTIVE", permissionKeys: ["y:two", "z:three"] },
    { roleKey: "C", status: "DISABLED", permissionKeys: ["secret:four"] },
  ]);
  assert.deepEqual(result, ["x:one", "y:two", "z:three"]);
});

test("computeEffectivePermissions returns empty for no roles", () => {
  assert.deepEqual(computeEffectivePermissions([]), []);
});

test("validateRoleInput enforces key and name rules", () => {
  assert.doesNotThrow(() => validateRoleInput({ key: "HR_ADMIN", name: "HR Admin" }));
  assert.throws(() => validateRoleInput({ key: "hr admin", name: "HR Admin" }), ValidationError);
  assert.throws(() => validateRoleInput({ key: "HR_ADMIN", name: "X" }), ValidationError);
});

test("assertSuperAdminSafe prevents removing SUPER_ADMIN from a super admin", () => {
  const roleKeysById = new Map([
    ["r1", "EMPLOYEE"],
    ["r2", "SUPER_ADMIN"],
  ]);
  const userRoles = [{ roleId: "r2" }];

  assert.throws(
    () => assertSuperAdminSafe(userRoles, roleKeysById, ["r1"]),
    ValidationError
  );
  // Keeping SUPER_ADMIN is fine.
  assert.doesNotThrow(() => assertSuperAdminSafe(userRoles, roleKeysById, ["r2"]));
  // A non-super-admin can be reassigned freely.
  assert.doesNotThrow(() => assertSuperAdminSafe([], roleKeysById, ["r1"]));
});

test("isWithinTeamScope matches only exact reporting lines", () => {
  assert.equal(isWithinTeamScope("u_mgr", "u_mgr"), true);
  assert.equal(isWithinTeamScope("u_other", "u_mgr"), false);
  assert.equal(isWithinTeamScope(null, "u_mgr"), false);
  assert.equal(isWithinTeamScope(undefined, "u_mgr"), false);
  // Object ids are compared by string value, so ObjectId-shaped values match.
  assert.equal(isWithinTeamScope({ toString: () => "u_mgr" }, "u_mgr"), true);
});

test("assertValidManagerAssignment rejects self-reporting", () => {
  assert.throws(
    () => assertValidManagerAssignment({ userId: "u_1", managerId: "u_1" }),
    ValidationError
  );
  assert.doesNotThrow(() =>
    assertValidManagerAssignment({ userId: "u_1", managerId: "u_2" })
  );
  assert.doesNotThrow(() =>
    assertValidManagerAssignment({ userId: "u_1", managerId: null })
  );
  assert.doesNotThrow(() =>
    assertValidManagerAssignment({ userId: "u_1", managerId: "" })
  );
});
