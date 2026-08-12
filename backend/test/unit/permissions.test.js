/**
 * Domain tests: permission registry invariants (FR-002).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  PERMISSION_REGISTRY,
  ALL_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  assertRegisteredPermission,
  hasPermission,
} = require("../../src/domain/permissions");

test("every registered permission is a module:action string", () => {
  for (const key of ALL_PERMISSIONS) {
    assert.match(key, /^[a-z_]+:[a-z_]+$/);
  }
});

test("all permission keys are unique", () => {
  assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
});

test("registry is grouped by module and covers required modules", () => {
  const modules = Object.keys(PERMISSION_REGISTRY);
  for (const expected of [
    "DASHBOARD",
    "PROFILE",
    "ATTENDANCE",
    "OVERTIME",
    "TRIP",
    "LEAVE",
    "USERS",
    "ORG",
    "REPORTING",
    "RBAC",
    "AUDIT",
    "TEAM",
    "PLATFORM",
  ]) {
    assert.ok(modules.includes(expected), `missing module ${expected}`);
  }
});

test("TEAM module registers team-scoped permissions", () => {
  assert.deepEqual(
    [...PERMISSION_REGISTRY.TEAM].sort(),
    ["approval:delegate", "delegation:manage", "team:view_pending", "team:view_team"]
  );
  assert.ok(PERMISSION_DEFINITIONS["team:view_team"]);
  assert.ok(PERMISSION_DEFINITIONS["team:view_pending"]);
  assert.ok(PERMISSION_DEFINITIONS["delegation:manage"]);
  assert.ok(PERMISSION_DEFINITIONS["approval:delegate"]);
});

test("every definition in PERMISSION_DEFINITIONS matches registry", () => {
  const flat = Object.values(PERMISSION_REGISTRY).flat();
  assert.equal(Object.keys(PERMISSION_DEFINITIONS).length, flat.length);
  for (const key of flat) {
    assert.ok(PERMISSION_DEFINITIONS[key], `missing definition ${key}`);
    assert.equal(PERMISSION_DEFINITIONS[key].key, key);
  }
});

test("assertRegisteredPermission accepts registered keys and rejects unknown", () => {
  assert.equal(assertRegisteredPermission("attendance:clock_in"), "attendance:clock_in");
  assert.throws(() => assertRegisteredPermission("not:real"), /Unknown permission/);
});

test("hasPermission checks literal membership", () => {
  assert.equal(hasPermission(["leave:approve", "dashboard:view"], "leave:approve"), true);
  assert.equal(hasPermission(["leave:approve"], "users:create"), false);
});

test("hasPermission wildcard grants everything", () => {
  assert.equal(hasPermission(["*"], "rbac:manage_permissions"), true);
  assert.equal(hasPermission(["*"], "any:thing"), true);
});

test("seed role permission keys all exist in registry", () => {
  const { ROLE_SEED } = require("../../src/infrastructure/seed/seed");
  for (const role of ROLE_SEED) {
    for (const key of role.permissions) {
      assert.ok(PERMISSION_DEFINITIONS[key], `role ${role.key} has unknown key ${key}`);
    }
  }
});

test("SUPER_ADMIN seed role inherits every permission", () => {
  const { ROLE_SEED } = require("../../src/infrastructure/seed/seed");
  const superAdmin = ROLE_SEED.find((r) => r.key === "SUPER_ADMIN");
  assert.deepEqual([...superAdmin.permissions].sort(), [...ALL_PERMISSIONS].sort());
});
