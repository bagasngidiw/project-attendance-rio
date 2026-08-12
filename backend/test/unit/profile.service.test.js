/**
 * ProfileService tests (FR-021): read own profile, self-service updates with
 * audit, HR-field rejection, and email-conflict handling.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { ProfileService } = require("../../src/application/profile.service");
const { ConflictError, FieldNotEditableError } = require("../../src/domain/errors");

function makeService() {
  const fakes = buildFakes();
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
  const service = new ProfileService({
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
  });
  return { service, fakes, auditService };
}

async function seedUser(fakes, { id = "u_emp", email = "jane@corp.io", username = "jane" } = {}) {
  fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const user = await fakes.userRepository.create({
    username,
    email,
    name: "Jane Doe",
    passwordHash: "hash",
    status: "ACTIVE",
  });
  await fakes.userRoleRepository.replaceRolesForUser(user.id, ["r_emp"]);
  return user;
}

test("getMyProfile returns the caller's profile with roles and masked bank account", async () => {
  const { service, fakes } = makeService();
  const user = await seedUser(fakes);
  user.bankAccount = "1234567890";

  const profile = await service.getMyProfile(user.id);
  assert.equal(profile.username, "jane");
  assert.equal(profile.name, "Jane Doe");
  assert.equal(profile.bankAccount, "****7890");
  assert.deepEqual(profile.roles, ["EMPLOYEE"]);
  assert.equal(profile.status, "ACTIVE");
});

test("updateMyProfile persists self-service fields and records PROFILE.UPDATED", async () => {
  const { service, fakes, auditService } = makeService();
  const user = await seedUser(fakes);

  const updated = await service.updateMyProfile(
    user.id,
    { phone: "+1-555-0199", address: "New Street 1", bankAccount: "9876543210" },
    { actorId: user.id, actorRoleKeys: ["EMPLOYEE"] }
  );

  assert.equal(updated.phone, "+1-555-0199");
  assert.equal(updated.address, "New Street 1");
  assert.equal(updated.bankAccount, "****3210");

  const audit = fakes.auditRepository.entries.find((e) => e.action === "PROFILE.UPDATED");
  assert.ok(audit, "PROFILE.UPDATED audit event");
  assert.deepEqual(audit.metadata.changedFields.sort(), ["address", "bankAccount", "phone"]);
  assert.ok(
    fakes.activityRepository.entries.some((e) => e.action === "PROFILE.UPDATED"),
    "also on the activity surface"
  );
  void auditService;
});

test("updateMyProfile rejects HR-managed fields (E1)", async () => {
  const { service, fakes } = makeService();
  const user = await seedUser(fakes);

  await assert.rejects(
    service.updateMyProfile(user.id, { name: "Renamed", phone: "x" }, {}),
    (err) => err instanceof FieldNotEditableError && err.details.field === "name"
  );
  await assert.rejects(
    service.updateMyProfile(user.id, { status: "INACTIVE" }, {}),
    FieldNotEditableError
  );
});

test("updateMyProfile rejects an email already used by another user", async () => {
  const { service, fakes } = makeService();
  await seedUser(fakes, { id: "u_emp", email: "jane@corp.io" });
  const other = await seedUser(fakes, { id: "u_other", email: "other@corp.io", username: "other" });

  await assert.rejects(
    service.updateMyProfile(other.id, { email: "jane@corp.io" }, {}),
    ConflictError
  );
  // Updating with the same user's own email is fine.
  await service.updateMyProfile(other.id, { email: "other@corp.io" }, {});
});
