/**
 * Access-report domain tests — pure helpers used by
 * `scripts/show-access-collections.js` (website-access inspector).
 *
 * Security focus: `sanitizeUser` must never leak password/token bookkeeping.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeUser,
  roleRow,
  userRow,
  buildMenuTree,
} = require("../../src/domain/access-report");

test("sanitizeUser strips password and token bookkeeping fields", () => {
  const raw = {
    _id: "user-123",
    username: "superadmin",
    name: "Super Administrator",
    email: "superadmin@corp.io",
    status: "ACTIVE",
    roleIds: ["role-a", "role-b"],
    passwordHash: "secret-hash",
    passwordHistory: ["old-hash-1", "old-hash-2"],
    passwordVersion: 3,
    passwordChangedAt: new Date(),
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenVersion: 1,
    mustChangePassword: true,
    __v: 0,
    notificationPreferences: { email: true },
  };

  const out = sanitizeUser(raw);

  assert.equal(out.id, "user-123");
  assert.equal(out.username, "superadmin");
  assert.equal(out.name, "Super Administrator");
  assert.equal(out.email, "superadmin@corp.io");
  assert.equal(out.status, "ACTIVE");
  assert.deepEqual(out.roleIds, ["role-a", "role-b"]);

  // Secrets / internals must never appear.
  assert.equal(Object.hasOwn(out, "passwordHash"), false);
  assert.equal(Object.hasOwn(out, "passwordHistory"), false);
  assert.equal(Object.hasOwn(out, "passwordVersion"), false);
  assert.equal(Object.hasOwn(out, "passwordChangedAt"), false);
  assert.equal(Object.hasOwn(out, "failedLoginAttempts"), false);
  assert.equal(Object.hasOwn(out, "lockedUntil"), false);
  assert.equal(Object.hasOwn(out, "tokenVersion"), false);
  assert.equal(Object.hasOwn(out, "mustChangePassword"), false);
  assert.equal(Object.hasOwn(out, "__v"), false);
  assert.equal(Object.hasOwn(out, "notificationPreferences"), false);
});

test("sanitizeUser maps missing _id/roleIds defensively", () => {
  const out = sanitizeUser({ id: "plain-id", username: "u", name: "N", email: "e@x.io", status: "ACTIVE" });
  assert.equal(out.id, "plain-id");
  assert.deepEqual(out.roleIds, []);
});

test("roleRow returns sorted permission keys and role metadata", () => {
  const role = {
    key: "MANAGER",
    name: "Manager",
    level: 50,
    levelLabel: "Lower-Level Approver",
    dataScope: "DIRECT_SUBORDINATES",
    status: "ACTIVE",
  };
  const keys = new Set(["trip:approve", "leave:approve", "attendance:view_all"]);

  const row = roleRow(role, keys);

  assert.equal(row.key, "MANAGER");
  assert.equal(row.name, "Manager");
  assert.equal(row.level, 50);
  assert.equal(row.levelLabel, "Lower-Level Approver");
  assert.equal(row.dataScope, "DIRECT_SUBORDINATES");
  assert.equal(row.status, "ACTIVE");
  assert.deepEqual(row.permissions, [
    "attendance:view_all",
    "leave:approve",
    "trip:approve",
  ]);
});

test("roleRow falls back to empty levelLabel when absent", () => {
  const row = roleRow({ key: "X", name: "X", level: 10, dataScope: "SELF", status: "ACTIVE" }, []);
  assert.equal(row.levelLabel, "");
  assert.deepEqual(row.permissions, []);
});

test("userRow resolves role keys via map, ignores unknown ids, sorts roles", () => {
  const roleKeysById = new Map([
    ["role-hr", "HR_ADMIN"],
    ["role-mgr", "MANAGER"],
  ]);

  const user = {
    username: "budi",
    name: "Budi Santoso",
    email: "budi@corp.io",
    status: "ACTIVE",
    roleIds: ["role-mgr", "role-gone", "role-hr"],
  };

  const row = userRow(user, roleKeysById);

  assert.equal(row.username, "budi");
  assert.equal(row.name, "Budi Santoso");
  assert.equal(row.email, "budi@corp.io");
  assert.equal(row.status, "ACTIVE");
  assert.deepEqual(row.roles, ["HR_ADMIN", "MANAGER"]);
});

test("userRow returns empty roles for a user without roleIds", () => {
  const row = userRow(
    { username: "no-role", name: "No Role", email: "n@corp.io", status: "ACTIVE" },
    new Map()
  );
  assert.deepEqual(row.roles, []);
});

test("buildMenuTree grants nodes whose permissions intersect the set", () => {
  const tree = buildMenuTree(["dashboard:view", "users:view"]);

  const flatLeaves = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) walk(node.children);
      else flatLeaves.push(node.id);
    }
  };
  walk(tree);

  // dashboard:view grants Dasbor; users:view grants Pengguna.
  assert.ok(flatLeaves.includes("nav.dashboard"), "expected nav.dashboard in tree");
  assert.ok(flatLeaves.includes("nav.users"), "expected nav.users in tree");
  // rbac:view_roles is NOT granted, so the RBAC console leaf must be pruned.
  assert.equal(flatLeaves.includes("nav.rbac"), false, "nav.rbac should be pruned");
});

test("buildMenuTree returns empty tree for empty permission set", () => {
  assert.deepEqual(buildMenuTree([]), []);
});

test("buildMenuTree treats wildcard as granting everything", () => {
  const tree = buildMenuTree(["*"]);
  const flatLeaves = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) walk(node.children);
      else flatLeaves.push(node.id);
    }
  };
  walk(tree);

  assert.ok(flatLeaves.includes("nav.dashboard"));
  assert.ok(flatLeaves.includes("nav.rbac"));
  assert.ok(flatLeaves.includes("nav.platform_settings"));
});
