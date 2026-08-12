/**
 * RbacService unit tests (FR-002): effective permissions, role assignment,
 * SUPER_ADMIN safety guard, audit emission.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { RbacService } = require("../../src/application/rbac.service");
const { ValidationError, NotFoundError, ConflictError } = require("../../src/domain/errors");

let fakes;
let rbacService;

beforeEach(() => {
  fakes = buildFakes();

  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee" });
  fakes.roleRepository.seed({ id: "r_manager", key: "MANAGER", name: "Manager" });
  fakes.roleRepository.seed({ id: "r_admin", key: "HR_ADMIN", name: "HR Admin" });
  fakes.roleRepository.seed({ id: "r_super", key: "SUPER_ADMIN", name: "Super Admin" });

  fakes.permissionRepository.assign("r_employee", ["dashboard:view", "leave:submit"]);
  fakes.permissionRepository.assign("r_manager", ["leave:submit", "leave:approve", "attendance:view_all"]);
  fakes.permissionRepository.assign("r_admin", ["leave:approve", "users:create"]);
  fakes.permissionRepository.assign("r_super", ["*"]);

  fakes.userRepository.seed({ id: "u_1", username: "bob", email: "bob@corp.io", name: "Bob", passwordHash: "x" });
  fakes.userRepository.seed({ id: "u_2", username: "alice", email: "alice@corp.io", name: "Alice", passwordHash: "x" });

  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
  });
  rbacService = new RbacService({
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    permissionRepository: fakes.permissionRepository,
    auditService,
  });
});

test("effective permissions are the union of all assigned ACTIVE roles", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_employee", "r_manager"]);

  const perms = await rbacService.getEffectivePermissions("u_1");
  assert.deepEqual(perms, ["attendance:view_all", "dashboard:view", "leave:approve", "leave:submit"]);
});

test("effective permissions respect role status", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_employee", "r_manager"]);
  fakes.roleRepository.roles.get("r_manager").status = "DISABLED";

  const perms = await rbacService.getEffectivePermissions("u_1");
  assert.deepEqual(perms, ["dashboard:view", "leave:submit"]);
});

test("user with no roles has no effective permissions", async () => {
  const perms = await rbacService.getEffectivePermissions("u_2");
  assert.deepEqual(perms, []);
});

test("assignRoles replaces the role set and bumps tokenVersion", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_employee"]);

  const result = await rbacService.assignRoles("u_1", ["r_manager"], {
    actorId: "u_2",
    actorUsername: "alice",
  });

  assert.deepEqual(result.roles, ["MANAGER"]);
  const user = fakes.userRepository.users.get("u_1");
  assert.equal(user.tokenVersion, 1);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "RBAC.ROLES_ASSIGNED"
  );
  assert.ok(audit);
  assert.equal(audit.actor.userId, "u_2");
  assert.deepEqual(audit.metadata.previousRoleIds, ["r_employee"]);
  assert.deepEqual(audit.metadata.assignedRoleKeys, ["MANAGER"]);
});

test("assignRoles rejects unknown roles", async () => {
  await assert.rejects(
    rbacService.assignRoles("u_1", ["r_does_not_exist"], { actorId: "u_2" }),
    NotFoundError
  );
});

test("assignRoles rejects empty role sets", async () => {
  await assert.rejects(
    rbacService.assignRoles("u_1", [], { actorId: "u_2" }),
    ValidationError
  );
});

test("assignRoles rejects disabled roles", async () => {
  fakes.roleRepository.roles.get("r_manager").status = "DISABLED";
  await assert.rejects(
    rbacService.assignRoles("u_1", ["r_manager"], { actorId: "u_2" }),
    ConflictError
  );
});

test("assignRoles blocks removing SUPER_ADMIN from a super admin", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_super"]);
  await assert.rejects(
    rbacService.assignRoles("u_1", ["r_employee"], { actorId: "u_2" }),
    ValidationError
  );
});

test("listRoles returns roles with their permission keys", async () => {
  const roles = await rbacService.listRoles();
  const employee = roles.find((r) => r.key === "EMPLOYEE");
  assert.deepEqual(employee.permissions, ["dashboard:view", "leave:submit"]);
});

test("listPermissionsGrouped returns modules with keys", async () => {
  const grouped = await rbacService.listPermissionsGrouped();
  assert.equal(grouped.length, 0); // in-memory fake has no persisted registry
});

test("getUserEffectivePermissions returns set for existing user", async () => {
  fakes.userRoleRepository.assign("u_1", ["r_admin"]);
  const { permissions } = await rbacService.getUserEffectivePermissions("u_1");
  assert.deepEqual(permissions, ["leave:approve", "users:create"]);
});

test("getUserEffectivePermissions rejects unknown user", async () => {
  await assert.rejects(
    rbacService.getUserEffectivePermissions("u_missing"),
    NotFoundError
  );
});
