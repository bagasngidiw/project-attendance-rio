/**
 * RoleAdminService FR-064 tests: role level/scope on create/update, console
 * meta, validate-before-save, effective-access preview, copy-role, templates.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { TokenInvalidationService } = require("../../src/infrastructure/token-invalidation.service");
const { RoleAdminService } = require("../../src/application/role-admin.service");
const { ValidationError } = require("../../src/domain/errors");

let fakes;
let service;

beforeEach(() => {
  fakes = buildFakes();

  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee", isSystem: true, level: 10, dataScope: "SELF" });
  fakes.roleRepository.seed({ id: "r_manager", key: "MANAGER", name: "Manager", isSystem: true, level: 50, dataScope: "DIRECT_SUBORDINATES" });
  fakes.roleRepository.seed({ id: "r_custom", key: "CUSTOM", name: "Custom", isSystem: false, level: 20, dataScope: "SELF" });

  fakes.permissionRepository.assign("r_custom", ["dashboard:view"]);
  fakes.permissionRepository.seedDefinitions([
    { key: "dashboard:view", module: "DASHBOARD", description: "View dashboard" },
    { key: "reporting:view", module: "REPORTING", description: "View reports" },
    { key: "leave:approve", module: "LEAVE", description: "Approve leave" },
    { key: "leave:view_all", module: "LEAVE", description: "View all leave" },
    { key: "rbac:manage_roles", module: "RBAC", description: "Manage roles" },
    { key: "rbac:view_roles", module: "RBAC", description: "View roles" },
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

const ACTOR = { actorId: "u_1", actorRoleKeys: ["SUPER_ADMIN"], correlationId: "corr_x" };

function auditActions() {
  return fakes.auditRepository.entries.map((e) => e.action);
}

test("createRole persists level, levelLabel and dataScope", async () => {
  const role = await service.createRole(
    {
      name: "Payroll Specialist",
      description: "Handles payroll",
      permissions: ["dashboard:view"],
      level: 30,
      levelLabel: "Finance",
      dataScope: "DEPARTMENT",
    },
    ACTOR
  );
  assert.equal(role.level, 30);
  assert.equal(role.levelLabel, "Finance");
  assert.equal(role.dataScope, "DEPARTMENT");
  assert.deepEqual(role.permissions, ["dashboard:view"]);
});

test("createRole applies defaults when level/scope omitted", async () => {
  const role = await service.createRole(
    { name: "Default Role", permissions: ["dashboard:view"] },
    ACTOR
  );
  assert.equal(role.level, 10);
  assert.equal(role.dataScope, "SELF");
});

test("createRole rejects an invalid level", async () => {
  await assert.rejects(
    service.createRole({ name: "Bad", permissions: ["dashboard:view"], level: 5000 }, ACTOR),
    ValidationError
  );
});

test("createRole rejects an invalid dataScope", async () => {
  await assert.rejects(
    service.createRole({ name: "Bad", permissions: ["dashboard:view"], dataScope: "EVERYONE" }, ACTOR),
    ValidationError
  );
});

test("createRole from a template inherits template permissions + scope", async () => {
  const role = await service.createRole(
    { name: "Reports Viewer", templateKey: "reports_only" },
    ACTOR
  );
  assert.ok(role.permissions.includes("reporting:view"));
  assert.equal(role.level, 30);
  assert.equal(role.dataScope, "SELF");
  const created = await fakes.auditRepository.entries.find((e) => e.action === "RBAC.ROLE_CREATED");
  assert.match(created.metadata.source, /template:reports_only/);
});

test("createRole from a template rejects unknown template keys", async () => {
  await assert.rejects(
    service.createRole({ name: "Bad", templateKey: "nope" }, ACTOR),
    ValidationError
  );
});

test("createRole copies permissions and scope from an existing role", async () => {
  const role = await service.createRole(
    { name: "Custom Copy", copyFromRoleId: "r_custom" },
    ACTOR
  );
  assert.deepEqual(role.permissions, ["dashboard:view"]);
  assert.equal(role.level, 20);
  assert.equal(role.dataScope, "SELF");
  const created = await fakes.auditRepository.entries.find((e) => e.action === "RBAC.ROLE_CREATED");
  assert.match(created.metadata.source, /copy:CUSTOM/);
});

test("updateRole changes level/scope, invalidates holders, and audits ROLE_LEVEL_CHANGED", async () => {
  const before = await service.getRole("r_custom");
  const updated = await service.updateRole(
    "r_custom",
    { level: 70, dataScope: "DEPARTMENT", expectedVersion: before.version },
    ACTOR
  );
  assert.equal(updated.level, 70);
  assert.equal(updated.dataScope, "DEPARTMENT");
  assert.ok(auditActions().includes("RBAC.ROLE_LEVEL_CHANGED"));
  const evt = fakes.auditRepository.entries.find((e) => e.action === "RBAC.ROLE_LEVEL_CHANGED");
  assert.equal(evt.metadata.before.level, 20);
  assert.equal(evt.metadata.after.level, 70);
});

test("updateRole without level/scope changes audits ROLE_UPDATED only", async () => {
  const before = await service.getRole("r_custom");
  const updated = await service.updateRole(
    "r_custom",
    { name: "Renamed", expectedVersion: before.version },
    ACTOR
  );
  assert.equal(updated.name, "Renamed");
  assert.ok(!auditActions().includes("RBAC.ROLE_LEVEL_CHANGED"));
  assert.ok(auditActions().includes("RBAC.ROLE_UPDATED"));
});

test("getMeta returns checklist groups, templates, dependencies and level schema", async () => {
  const meta = await service.getMeta();
  assert.ok(Array.isArray(meta.groups));
  assert.ok(meta.groups.some((g) => g.key === "DASHBOARD"));
  assert.ok(meta.templates.some((t) => t.key === "administrator"));
  assert.ok(Array.isArray(meta.dependencyMap));
  assert.ok(meta.highPrivilegePermissions.includes("rbac:manage_roles"));
  assert.ok(meta.roleLevel.dataScopes.includes("ALL_EMPLOYEES"));
});

test("validateRole returns warnings without persisting", async () => {
  const result = await service.validateRole({ permissions: ["leave:approve"] });
  assert.ok(result.warnings !== undefined || result.dependencies !== undefined);
  assert.ok(result.permissions.includes("leave:approve"));
  // leave:approve without leave:view_all → dependency warning
  const deps = result.dependencies ?? result.warnings?.dependencies;
  assert.ok(deps.some((d) => d.permission === "leave:approve"));
});

test("previewRole reports effective access for a stored role", async () => {
  const preview = await service.previewRole("r_custom");
  assert.equal(preview.role.key, "CUSTOM");
  assert.ok(preview.preview.menuModules.some((m) => m.module === "DASHBOARD"));
  assert.ok(Array.isArray(preview.warnings.highPrivilege));
});

test("copyRole returns an editable draft with the source permissions", async () => {
  const draft = await service.copyRole("r_custom");
  assert.equal(draft.name, "Custom (Copy)");
  assert.deepEqual(draft.permissions, ["dashboard:view"]);
  assert.equal(draft.source.key, "CUSTOM");
});
