/**
 * RoleAdminService unit tests (FR-011): role lifecycle, permission diff
 * application, SUPER_ADMIN guard, optimistic lock, audit emission,
 * tokenVersion invalidation.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { TokenInvalidationService } = require("../../src/infrastructure/token-invalidation.service");
const { RoleAdminService } = require("../../src/application/role-admin.service");
const { ConflictError, ValidationError } = require("../../src/domain/errors");

let fakes;
let service;

beforeEach(() => {
  fakes = buildFakes();

  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee", isSystem: true });
  fakes.roleRepository.seed({ id: "r_admin", key: "HR_ADMIN", name: "HR Admin", isSystem: true });
  fakes.roleRepository.seed({ id: "r_super", key: "SUPER_ADMIN", name: "Super Admin", isSystem: true });
  fakes.roleRepository.seed({ id: "r_custom", key: "CUSTOM", name: "Custom", isSystem: false });

  fakes.permissionRepository.assign("r_custom", ["dashboard:view"]);
  fakes.permissionRepository.assign("r_super", [
    "dashboard:view",
    "rbac:manage_roles",
    "rbac:manage_permissions",
    "audit:view",
    "platform:settings",
  ]);
  fakes.permissionRepository.seedDefinitions([
    { key: "dashboard:view", module: "DASHBOARD", description: "View dashboard" },
    { key: "reporting:view", module: "REPORTING", description: "View reports" },
    { key: "reporting:export_excel", module: "REPORTING", description: "Export Excel" },
    { key: "rbac:manage_roles", module: "RBAC", description: "Manage roles" },
    { key: "rbac:manage_permissions", module: "RBAC", description: "Manage permissions" },
    { key: "audit:view", module: "AUDIT", description: "View audit" },
    { key: "platform:settings", module: "PLATFORM", description: "Platform settings" },
  ]);

  fakes.userRepository.seed({ id: "u_1", username: "bob", email: "bob@corp.io", name: "Bob", passwordHash: "x" });
  fakes.userRoleRepository.assign("u_1", ["r_custom"]);

  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
  });
  const tokenInvalidation = new TokenInvalidationService({
    userRepository: fakes.userRepository,
    userRoleRepository: fakes.userRoleRepository,
  });

  service = new RoleAdminService({
    roleRepository: fakes.roleRepository,
    permissionRepository: fakes.permissionRepository,
    rolePermissionRepository: fakes.rolePermissionRepository,
    userRoleRepository: fakes.userRoleRepository,
    userRepository: fakes.userRepository,
    tokenInvalidation,
    auditService,
  });
});

const ACTOR = { actorId: "u_1", actorRoleKeys: ["HR_ADMIN"], correlationId: "corr_x" };

test("createRole creates a role with normalized key + permissions and audits", async () => {
  const role = await service.createRole(
    {
      name: "Payroll Specialist",
      description: "Reviews payroll",
      permissions: ["reporting:view", "reporting:export_excel"],
    },
    ACTOR
  );

  assert.equal(role.key, "PAYROLL_SPECIALIST");
  assert.equal(role.isSystem, false);
  assert.equal(role.version, 1);
  assert.deepEqual(role.permissions, ["reporting:export_excel", "reporting:view"]);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "RBAC.ROLE_CREATED"
  );
  assert.ok(audit);
  assert.equal(audit.subject.summary, "PAYROLL_SPECIALIST");
});

test("createRole rejects duplicate keys", async () => {
  await assert.rejects(
    service.createRole(
      { name: "Employee", permissions: ["dashboard:view"] },
      ACTOR
    ),
    ConflictError
  );
});

test("createRole rejects empty permission lists", async () => {
  await assert.rejects(
    service.createRole({ name: "Empty", permissions: [] }, ACTOR),
    ValidationError
  );
});

test("updateRole renames and bumps version", async () => {
  const updated = await service.updateRole(
    "r_custom",
    { name: "Custom Renamed", description: "New desc", expectedVersion: 1 },
    ACTOR
  );
  assert.equal(updated.name, "Custom Renamed");
  assert.equal(updated.version, 2);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "RBAC.ROLE_UPDATED"
  );
  assert.ok(audit);
  assert.deepEqual(audit.metadata.before.name, "Custom");
});

test("updateRole rejects system roles", async () => {
  await assert.rejects(
    service.updateRole("r_employee", { name: "Hacked", expectedVersion: 1 }, ACTOR),
    ConflictError
  );
});

test("updateRole rejects stale version (optimistic lock)", async () => {
  await assert.rejects(
    service.updateRole("r_custom", { name: "Valid Name", expectedVersion: 99 }, ACTOR),
    ConflictError
  );
});

test("setRolePermissions applies diff, invalidates holders, and audits", async () => {
  const result = await service.setRolePermissions(
    "r_custom",
    {
      permissions: ["dashboard:view", "reporting:view"],
      reason: "payroll needs reports",
      expectedVersion: 1,
    },
    ACTOR
  );

  assert.deepEqual(result.permissions, ["dashboard:view", "reporting:view"]);
  assert.equal(result.affectedUsers, 1); // u_1 holds r_custom
  assert.equal(fakes.userRepository.users.get("u_1").tokenVersion, 1);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "RBAC.PERMISSION_CHANGED"
  );
  assert.ok(audit);
  assert.deepEqual(audit.metadata.added, ["reporting:view"]);
  assert.deepEqual(audit.metadata.removed, []);
  assert.equal(audit.metadata.reason, "payroll needs reports");
});

test("setRolePermissions blocks SUPER_ADMIN losing platform perms", async () => {
  await assert.rejects(
    service.setRolePermissions(
      "r_super",
      {
        permissions: ["dashboard:view"],
        expectedVersion: 1,
      },
      ACTOR
    ),
    ConflictError
  );
});

test("setRolePermissions rejects unknown permission keys", async () => {
  await assert.rejects(
    service.setRolePermissions(
      "r_custom",
      { permissions: ["bogus:key"], expectedVersion: 1 },
      ACTOR
    ),
    /Unknown permission/
  );
});

test("disableRole disables and invalidates holders; enable re-activates", async () => {
  const disabled = await service.disableRole("r_custom", { expectedVersion: 1 }, ACTOR);
  assert.equal(disabled.status, "DISABLED");
  assert.equal(disabled.affectedUsers, 1);

  const enabled = await service.enableRole("r_custom", { expectedVersion: 2 }, ACTOR);
  assert.equal(enabled.status, "ACTIVE");

  const audits = fakes.auditRepository.entries
    .map((e) => e.action)
    .filter((a) => a === "RBAC.ROLE_DISABLED" || a === "RBAC.ROLE_ENABLED");
  assert.deepEqual(audits, ["RBAC.ROLE_DISABLED", "RBAC.ROLE_ENABLED"]);
});

test("disableRole rejects system roles", async () => {
  await assert.rejects(
    service.disableRole("r_employee", { expectedVersion: 1 }, ACTOR),
    ConflictError
  );
});

test("getRole returns role with permissions and version", async () => {
  const role = await service.getRole("r_custom");
  assert.deepEqual(role.permissions, ["dashboard:view"]);
  assert.equal(role.version, 1);
});

test("getUserEffectivePermissionsDetailed returns union with per-role breakdown", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_custom"]);
  fakes.permissionRepository.assign("r_custom", ["dashboard:view", "reporting:view"]);

  const result = await service.getUserEffectivePermissionsDetailed("u_1");
  assert.equal(result.username, "bob");
  assert.deepEqual(result.roles, ["CUSTOM"]);
  assert.deepEqual(result.permissions, ["dashboard:view", "reporting:view"]);
  assert.equal(result.breakdown.length, 1);
  assert.deepEqual(result.breakdown[0].roleKey, "CUSTOM");
});

test("getMatrix groups permissions by module with grantedTo", async () => {
  fakes.permissionRepository.assign("r_custom", ["dashboard:view"]);
  fakes.rolePermissionRepository.assign("r_custom", ["dashboard:view"]);
  const matrix = await service.getMatrix();

  const dashboard = matrix.find((m) => m.module === "DASHBOARD");
  assert.ok(dashboard);
  const viewPerm = dashboard.permissions.find((p) => p.key === "dashboard:view");
  assert.ok(viewPerm.grantedTo.includes("r_custom"));
});
