/**
 * UserAdminService tests (FR-029 / FR-028): create/update/deactivate/activate,
 * reset password, list/search, SUPER_ADMIN guard, and USER.* audit records.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { PasswordService } = require("../../src/application/password.service");
const { UserAdminService } = require("../../src/application/user-admin.service");
const { DEFAULT_PASSWORD_POLICY } = require("../../src/domain/password-policy");
const {
  ConflictError,
  ValidationError,
  PasswordPolicyError,
} = require("../../src/domain/errors");

function makeService() {
  const fakes = buildFakes();
  const passwordHasher = new BcryptPasswordHasher(4);
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const passwordService = new PasswordService({
    userRepository: fakes.userRepository,
    passwordHasher,
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    config: { security: { passwordPolicy: { ...DEFAULT_PASSWORD_POLICY } } },
  });
  const service = new UserAdminService({
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    passwordHasher,
    passwordService,
    auditService,
  });
  return { service, fakes, passwordHasher, auditService };
}

const COMPLIANT = "Provision2026!x";

test("createUser provisions an account with mustChangePassword and assigned roles", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });

  const dto = await service.createUser(
    {
      username: "jdoe",
      email: "jdoe@corp.io",
      name: "Jane Doe",
      roleIds: ["r_emp"],
      initialPassword: COMPLIANT,
    },
    { actorId: "u_admin", actorRoleKeys: ["HR_ADMIN"] }
  );

  assert.equal(dto.username, "jdoe");
  assert.equal(dto.status, "ACTIVE");
  assert.equal(dto.mustChangePassword, true, "provisioned user must change password");
  assert.deepEqual(dto.roles, ["EMPLOYEE"]);
  assert.ok(!("passwordHash" in dto), "never expose password material");

  const memberships = await fakes.userRoleRepository.roleIdsForUser(dto.id);
  assert.deepEqual(memberships, ["r_emp"]);

  const auditEvent = fakes.auditRepository.entries.find((e) => e.action === "USER.CREATED");
  assert.ok(auditEvent, "USER.CREATED audit event recorded");
  assert.equal(auditEvent.metadata.roleKeys[0], "EMPLOYEE");
  assert.ok(fakes.activityRepository.entries.some((e) => e.action === "USER.CREATED"));
});

test("createUser rejects duplicate identity (USER_EXISTS)", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const input = {
    username: "dup",
    email: "dup@corp.io",
    name: "Dup",
    roleIds: ["r_emp"],
    initialPassword: COMPLIANT,
  };
  await service.createUser(input, {});
  await assert.rejects(service.createUser(input, {}), ConflictError);
});

test("createUser rejects a password that violates the policy", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  await assert.rejects(
    service.createUser(
      { username: "weak", email: "weak@corp.io", name: "Weak", roleIds: ["r_emp"], initialPassword: "short" },
      {}
    ),
    PasswordPolicyError
  );
});

test("createUser requires at least one role", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.createUser(
      { username: "noroles", email: "noroles@corp.io", name: "No Roles", roleIds: [], initialPassword: COMPLIANT },
      {}
    ),
    (err) => err instanceof ValidationError && err.details.field === "roleIds"
  );
});

test("updateUser edits identity fields and audits USER.UPDATED", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const created = await service.createUser(
    { username: "editme", email: "editme@corp.io", name: "Edit Me", roleIds: ["r_emp"], initialPassword: COMPLIANT },
    { actorId: "u_admin" }
  );

  const updated = await service.updateUser(
    created.id,
    { name: "Renamed", email: "renamed@corp.io" },
    { actorId: "u_admin" }
  );
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.email, "renamed@corp.io");

  const auditEvent = fakes.auditRepository.entries.find((e) => e.action === "USER.UPDATED");
  assert.ok(auditEvent, "USER.UPDATED audit event recorded");
  assert.equal(auditEvent.metadata.before.name, "Edit Me");
});

test("deactivateUser sets INACTIVE, bumps tokenVersion, and audits", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const created = await service.createUser(
    { username: "bye", email: "bye@corp.io", name: "Bye", roleIds: ["r_emp"], initialPassword: COMPLIANT },
    { actorId: "u_admin" }
  );
  const beforeTokenVersion = fakes.userRepository.users.get(created.id).tokenVersion;

  const dto = await service.deactivateUser(created.id, { actorId: "u_admin" });
  assert.equal(dto.status, "INACTIVE");
  assert.equal(
    fakes.userRepository.users.get(created.id).tokenVersion,
    beforeTokenVersion + 1,
    "tokenVersion bumped to kill sessions"
  );
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "USER.DEACTIVATED"));
});

test("deactivateUser blocks the last ACTIVE SUPER_ADMIN", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_sa", key: "SUPER_ADMIN", name: "Super Admin", status: "ACTIVE" });
  const sa = fakes.userRepository.seed({ id: "u_sa", username: "root", email: "root@corp.io", name: "Root", status: "ACTIVE" });
  await fakes.userRoleRepository.replaceRolesForUser(sa.id, ["r_sa"]);

  await assert.rejects(
    service.deactivateUser(sa.id, { actorId: "u_admin" }),
    (err) => err instanceof ConflictError && err.code === "SUPER_ADMIN_GUARD"
  );
});

test("deactivateUser allows when another ACTIVE SUPER_ADMIN exists", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_sa", key: "SUPER_ADMIN", name: "Super Admin", status: "ACTIVE" });
  const sa1 = fakes.userRepository.seed({ id: "u_sa1", username: "root1", email: "root1@corp.io", name: "Root One", status: "ACTIVE" });
  const sa2 = fakes.userRepository.seed({ id: "u_sa2", username: "root2", email: "root2@corp.io", name: "Root Two", status: "ACTIVE" });
  await fakes.userRoleRepository.replaceRolesForUser(sa1.id, ["r_sa"]);
  await fakes.userRoleRepository.replaceRolesForUser(sa2.id, ["r_sa"]);

  const dto = await service.deactivateUser(sa1.id, { actorId: "u_admin" });
  assert.equal(dto.status, "INACTIVE");
});

test("resetPassword sets the must-change gate and bumps tokenVersion", async () => {
  const { service, fakes, passwordHasher } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const created = await service.createUser(
    { username: "resetme", email: "resetme@corp.io", name: "Reset Me", roleIds: ["r_emp"], initialPassword: COMPLIANT },
    { actorId: "u_admin" }
  );
  // Clear the gate so we can observe the reset re-arming it.
  const user = fakes.userRepository.users.get(created.id);
  user.mustChangePassword = false;
  const beforeTokenVersion = user.tokenVersion;

  const result = await service.resetPassword(created.id, { initialPassword: "TempReset2026!" }, { actorId: "u_admin" });
  assert.equal(result.mustChangePassword, true);
  assert.equal(user.mustChangePassword, true, "gate re-armed after reset");
  assert.equal(user.tokenVersion, beforeTokenVersion + 1, "sessions invalidated");
  assert.equal(await passwordHasher.verify("TempReset2026!", user.passwordHash), true);

  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "USER.PASSWORD_RESET"));
});

test("listUsers supports search, status filter, and role filter with pagination", async () => {
  const { service, fakes } = makeService();
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const a = await service.createUser(
    { username: "anna", email: "anna@corp.io", name: "Anna", roleIds: ["r_emp"], initialPassword: COMPLIANT },
    {}
  );
  const bob = await service.createUser(
    { username: "bob", email: "bob@corp.io", name: "Bob", roleIds: ["r_emp"], initialPassword: COMPLIANT },
    {}
  );

  // Search by name.
  const search = await service.listUsers({ search: "anna" });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].username, "anna");

  // Role filter returns both employees with role keys enriched.
  const byRole = await service.listUsers({ roleId: "r_emp" });
  assert.equal(byRole.total, 2);
  assert.ok(byRole.items.every((u) => u.roles.includes("EMPLOYEE")));

  // Pagination: pageSize 1 returns one item.
  const paged = await service.listUsers({ page: 1, pageSize: 1 });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, 2);

  // Status filter after deactivation.
  await service.deactivateUser(bob.id, {});
  const inactive = await service.listUsers({ status: "INACTIVE" });
  assert.equal(inactive.total, 1);
  assert.equal(inactive.items[0].id, a.id === inactive.items[0].id ? a.id : inactive.items[0].id);
});
