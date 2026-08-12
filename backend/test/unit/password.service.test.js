/**
 * PasswordService tests (FR-028 / FR-044): policy resolution + update, and the
 * self-service change-password flow (current-password verification, policy
 * enforcement, reuse blocking, version bumps, audit).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { PasswordService } = require("../../src/application/password.service");
const { DEFAULT_PASSWORD_POLICY } = require("../../src/domain/password-policy");
const {
  CurrentPasswordInvalidError,
  PasswordPolicyError,
} = require("../../src/domain/errors");

function makeService(policyOverrides = {}) {
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
  const service = new PasswordService({
    userRepository: fakes.userRepository,
    passwordHasher,
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    config: {
      security: {
        passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, ...policyOverrides },
      },
    },
  });
  return { service, fakes, passwordHasher, auditService };
}

async function seedUser(fakes, passwordHasher, { username = "alice", password = "InitialPass2026!" } = {}) {
  const hash = await passwordHasher.hash(password);
  return fakes.userRepository.seed({
    id: "u_alice",
    username,
    email: `${username}@corp.io`,
    name: "Alice",
    passwordHash: hash,
    mustChangePassword: true,
  });
}

test("getPasswordPolicy returns config defaults when nothing is stored", async () => {
  const { service } = makeService();
  const policy = await service.getPasswordPolicy();
  assert.equal(policy.minLength, DEFAULT_PASSWORD_POLICY.minLength);
  assert.equal(policy.historyLength, DEFAULT_PASSWORD_POLICY.historyLength);
});

test("getPasswordPolicy prefers stored policy over config defaults", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("password_policy", {
    ...DEFAULT_PASSWORD_POLICY,
    minLength: 14,
  });
  const policy = await service.getPasswordPolicy();
  assert.equal(policy.minLength, 14);
});

test("updatePasswordPolicy persists the policy and records SETTINGS.CHANGED", async () => {
  const { service, fakes } = makeService();
  const saved = await service.updatePasswordPolicy(
    { ...DEFAULT_PASSWORD_POLICY, minLength: 12 },
    { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] }
  );
  assert.equal(saved.minLength, 12);
  const stored = await fakes.platformSettingRepository.get("password_policy");
  assert.equal(stored.minLength, 12);
  const auditEvent = fakes.auditRepository.entries.find(
    (e) => e.action === "SETTINGS.CHANGED"
  );
  assert.ok(auditEvent, "policy change must be audited");
  assert.equal(String(auditEvent.actor.userId), "u_admin");
});

test("changePassword verifies current password and rotates credentials", async () => {
  const { service, fakes, passwordHasher } = makeService();
  const user = await seedUser(fakes, passwordHasher);
  const originalHash = user.passwordHash;

  const result = await service.changePassword(
    user.id,
    { currentPassword: "InitialPass2026!", newPassword: "NewPass2026!x" },
    { actorRoleKeys: ["EMPLOYEE"] }
  );
  assert.deepEqual(result, { success: true });

  const updated = fakes.userRepository.users.get(user.id);
  assert.equal(updated.mustChangePassword, false, "gate cleared after change");
  assert.equal(updated.passwordVersion, 1);
  assert.equal(updated.tokenVersion, 1, "tokenVersion bumped to kill stale tokens");
  assert.ok(updated.passwordChangedAt, "passwordChangedAt stamped");
  assert.equal(
    await passwordHasher.verify("NewPass2026!x", updated.passwordHash),
    true
  );
  assert.ok(
    updated.passwordHistory.includes(originalHash),
    "previous hash recorded in history"
  );

  const auditEvent = fakes.auditRepository.entries.find(
    (e) => e.action === "AUTH.PASSWORD_CHANGED"
  );
  assert.ok(auditEvent, "AUTH.PASSWORD_CHANGED audit event recorded");
  const activity = fakes.activityRepository.entries.find(
    (e) => e.action === "AUTH.PASSWORD_CHANGED"
  );
  assert.ok(activity, "AUTH.PASSWORD_CHANGED also lands on the activity surface");
});

test("changePassword rejects a wrong current password", async () => {
  const { service, fakes, passwordHasher } = makeService();
  const user = await seedUser(fakes, passwordHasher);
  await assert.rejects(
    service.changePassword(user.id, {
      currentPassword: "WrongPassword!",
      newPassword: "NewPass2026!x",
    }),
    CurrentPasswordInvalidError
  );
});

test("changePassword rejects policy-violating new passwords with violations", async () => {
  const { service, fakes, passwordHasher } = makeService();
  const user = await seedUser(fakes, passwordHasher);
  await assert.rejects(
    service.changePassword(user.id, {
      currentPassword: "InitialPass2026!",
      newPassword: "weakpass",
    }),
    (err) => {
      assert.ok(err instanceof PasswordPolicyError);
      assert.ok(Array.isArray(err.details.violations));
      assert.ok(err.details.violations.length > 0);
      return true;
    }
  );
});

test("changePassword blocks reuse of a recent password", async () => {
  const { service, fakes, passwordHasher } = makeService();
  const user = await seedUser(fakes, passwordHasher);

  await service.changePassword(user.id, {
    currentPassword: "InitialPass2026!",
    newPassword: "NewPass2026!x",
  });

  // The previous password is now in history — reusing it must be blocked.
  await assert.rejects(
    service.changePassword(user.id, {
      currentPassword: "NewPass2026!x",
      newPassword: "InitialPass2026!",
    }),
    PasswordPolicyError
  );
});

test("isPasswordExpired reflects the policy expiry window", async () => {
  const { service, fakes, passwordHasher } = makeService({ expiryDays: 30 });
  const user = await seedUser(fakes, passwordHasher);

  assert.equal(await service.isPasswordExpired(user), false);

  user.passwordChangedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(await service.isPasswordExpired(user), true);
});
