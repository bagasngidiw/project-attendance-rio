/**
 * Permission-checklist domain tests (FR-064).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChecklistGroups,
  dependencyWarnings,
  highPrivilegeWarnings,
  buildValidationReport,
  HIGH_PRIVILEGE_PERMISSIONS,
} = require("../../src/domain/permission-checklist");

test("checklist groups cover the permission registry modules", () => {
  const groups = buildChecklistGroups();
  const keys = new Set(groups.map((g) => g.key));
  for (const group of groups) {
    assert.ok(Array.isArray(group.permissions));
    for (const perm of group.permissions) {
      assert.ok(perm.key.includes(":"), `expected module:action, got ${perm.key}`);
    }
  }
  assert.ok(keys.has("DASHBOARD"));
  assert.ok(keys.has("REPORTING"));
  assert.ok(keys.has("RBAC"));
  assert.ok(keys.has("PLATFORM"));
});

test("dependencyWarnings flags approve without view-all", () => {
  const warnings = dependencyWarnings(["leave:approve"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].permission, "leave:approve");
  assert.ok(warnings[0].requires.includes("leave:view_all"));
});

test("dependencyWarnings is silent when the dependency is present", () => {
  const warnings = dependencyWarnings(["leave:approve", "leave:view_all"]);
  assert.equal(warnings.length, 0);
});

test("dependencyWarnings warns when export lacks reporting:view", () => {
  const warnings = dependencyWarnings(["reporting:export_excel"]);
  assert.ok(warnings.some((w) => w.permission === "reporting:export_excel"));
});

test("highPrivilegeWarnings flags elevated capabilities", () => {
  const warnings = highPrivilegeWarnings([
    "dashboard:view",
    "rbac:manage_roles",
    "users:reset_password",
    "platform:override_cutoff",
  ]);
  assert.deepEqual(warnings.sort(), [
    "platform:override_cutoff",
    "rbac:manage_roles",
    "users:reset_password",
  ].sort());
});

test("buildValidationReport returns groups, warnings and preview", () => {
  const report = buildValidationReport({
    permissions: ["leave:approve", "reporting:export_excel", "reporting:view"],
  });
  assert.ok(Array.isArray(report.groups));
  assert.equal(report.warnings.dependencies.length, 1); // leave:approve missing view_all
  assert.ok(
    report.preview.approvalAuthority.includes("leave:approve")
  );
  assert.ok(report.preview.reportPermissions.includes("reporting:export_excel"));
});

test("HIGH_PRIVILEGE_PERMISSIONS contains the wildcard full-access marker", () => {
  assert.ok(HIGH_PRIVILEGE_PERMISSIONS.includes("*"));
});
