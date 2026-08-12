/**
 * RecoveryService tests (FR-045): non-revealing request flow, cooldown
 * enforcement, token lifecycle (invalid/used/expired), policy compliance, and
 * the successful reset that rotates the password, bumps tokenVersion and
 * audits AUTH.PASSWORD_RECOVERED.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { PasswordService } = require("../../src/application/password.service");
const { RecoveryService } = require("../../src/application/recovery.service");
const {
  RECOVERY_PURPOSE,
  hashToken,
} = require("../../src/domain/recovery");
const { DEFAULT_PASSWORD_POLICY } = require("../../src/domain/password-policy");
const {
  ValidationError,
  NotFoundError,
  PasswordPolicyError,
} = require("../../src/domain/errors");

const stubHasher = {
  hash: async (value) => `hash:${value}`,
  verify: async (value, hash) => hash === `hash:${value}`,
};

/** In-memory recovery-token repository (no MongoDB). */
class InMemoryRecoveryTokenRepository {
  constructor() {
    this.tokens = [];
    this.nextId = 1;
  }

  async create({ userId, tokenHash, purpose, expiresAt }) {
    const doc = {
      id: `rt_${this.nextId++}`,
      userId: String(userId),
      tokenHash,
      purpose,
      expiresAt: new Date(expiresAt),
      usedAt: null,
      createdAt: new Date(),
    };
    this.tokens.push(doc);
    return doc;
  }

  async findValidByHash(tokenHash, purpose) {
    const now = new Date();
    return (
      this.tokens.find(
        (t) =>
          t.tokenHash === tokenHash &&
          t.purpose === purpose &&
          !t.usedAt &&
          new Date(t.expiresAt) > now
      ) ?? null
    );
  }

  async markUsed(id) {
    const doc = this.tokens.find((t) => t.id === id);
    if (doc) doc.usedAt = new Date();
  }

  async deleteExpired(now = new Date()) {
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((t) => new Date(t.expiresAt) >= now);
    return before - this.tokens.length;
  }

  async countRecentForUser(userId, since) {
    return this.tokens.filter(
      (t) => String(t.userId) === String(userId) && new Date(t.createdAt) >= new Date(since)
    ).length;
  }
}

let fakes;
let recoveryService;
let recoveryTokenRepository;
let auditService;
let passwordService;

beforeEach(() => {
  fakes = buildFakes();
  recoveryTokenRepository = new InMemoryRecoveryTokenRepository();
  auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: {
      verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }),
    },
  });
  passwordService = new PasswordService({
    userRepository: fakes.userRepository,
    passwordHasher: stubHasher,
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    config: { security: { passwordPolicy: { ...DEFAULT_PASSWORD_POLICY } } },
  });
  recoveryService = new RecoveryService({
    userRepository: fakes.userRepository,
    recoveryTokenRepository,
    passwordHasher: stubHasher,
    passwordService,
    sessionService: null,
    auditService,
    platformSettingRepository: fakes.platformSettingRepository,
  });
});

function seedUser({ id = "u_alice", username = "alice", email = "alice@corp.io", status = "ACTIVE", passwordHash = "hash:InitialPass2026!" } = {}) {
  return fakes.userRepository.seed({
    id,
    username,
    email,
    name: "Alice",
    status,
    passwordHash,
  });
}

function auditEvents(action) {
  return fakes.auditRepository.entries.filter((e) => e.action === action);
}

test("requestRecovery returns ok and mints a token for a known user without leaking it", async () => {
  seedUser();

  const result = await recoveryService.requestRecovery({ identifier: "alice" });
  assert.deepEqual(result, { ok: true });

  assert.equal(recoveryTokenRepository.tokens.length, 1);
  const stored = recoveryTokenRepository.tokens[0];
  assert.equal(stored.userId, "u_alice");
  assert.equal(stored.purpose, RECOVERY_PURPOSE);
  assert.ok(stored.expiresAt > new Date());
  assert.equal(stored.usedAt, null);

  const events = auditEvents("AUTH.RECOVERY_REQUESTED");
  assert.equal(events.length, 1);
  assert.equal(String(events[0].subject.id), "u_alice");
  assert.equal(events[0].actor.userId, "u_alice");
  assert.equal(events[0].outcome, "SUCCESS");
  assert.ok(!JSON.stringify(events[0].metadata ?? {}).includes("token"));
});

test("requestRecovery looks up by email as well as username", async () => {
  seedUser({ username: "alice", email: "alice@corp.io" });
  const result = await recoveryService.requestRecovery({ identifier: "alice@corp.io" });
  assert.deepEqual(result, { ok: true });
  assert.equal(recoveryTokenRepository.tokens.length, 1);
  assert.equal(recoveryTokenRepository.tokens[0].userId, "u_alice");
});

test("requestRecovery is non-revealing for an unknown identifier", async () => {
  seedUser();
  const result = await recoveryService.requestRecovery({ identifier: "ghost@corp.io" });
  assert.deepEqual(result, { ok: true });
  assert.equal(recoveryTokenRepository.tokens.length, 0);

  const events = auditEvents("AUTH.RECOVERY_REQUESTED");
  assert.equal(events.length, 1);
  assert.equal(events[0].subject.id, undefined);
  assert.equal(events[0].actor, null);
});

test("requestRecovery enforces the cooldown: no second token within cooldownMs", async () => {
  seedUser();
  await recoveryService.requestRecovery({ identifier: "alice" });
  await recoveryService.requestRecovery({ identifier: "alice" });

  assert.equal(recoveryTokenRepository.tokens.length, 1, "cooldown suppresses the second token");
  const events = auditEvents("AUTH.RECOVERY_REQUESTED");
  assert.equal(events.length, 2);
  assert.equal(events[1].metadata.rateLimited, true);
  assert.deepEqual(events[1].subject.id, "u_alice");
});

test("requestRecovery honors stored recoverySettings for cooldown", async () => {
  seedUser();
  await fakes.platformSettingRepository.set("recoverySettings", {
    cooldownMs: 0,
    tokenTtlMs: 900000,
  });
  await recoveryService.requestRecovery({ identifier: "alice" });
  await recoveryService.requestRecovery({ identifier: "alice" });
  assert.equal(recoveryTokenRepository.tokens.length, 2, "zero cooldown allows back-to-back tokens");
});

test("requestRecovery rejects a malformed identifier", async () => {
  await assert.rejects(
    recoveryService.requestRecovery({ identifier: "" }),
    ValidationError
  );
  assert.equal(recoveryTokenRepository.tokens.length, 0);
});

test("resetPassword rejects an unknown token", async () => {
  seedUser();
  await assert.rejects(
    recoveryService.resetPassword({ token: "never-issued", newPassword: "NewPass2026!x" }),
    ValidationError
  );
});

test("resetPassword rejects a used token", async () => {
  const user = seedUser();
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });

  await recoveryService.resetPassword({ token: "known-token", newPassword: "NewPass2026!x" });
  await assert.rejects(
    recoveryService.resetPassword({ token: "known-token", newPassword: "NewPass2026!y" }),
    ValidationError
  );
});

test("resetPassword rejects an expired token", async () => {
  const user = seedUser();
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("stale-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() - 1000),
  });
  await assert.rejects(
    recoveryService.resetPassword({ token: "stale-token", newPassword: "NewPass2026!x" }),
    ValidationError
  );
});

test("resetPassword rejects a policy-violating new password", async () => {
  const user = seedUser();
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });
  await assert.rejects(
    recoveryService.resetPassword({ token: "known-token", newPassword: "weakpass" }),
    (err) => {
      assert.ok(err instanceof PasswordPolicyError);
      assert.ok(err.details.violations.length > 0);
      return true;
    }
  );
  assert.equal(recoveryTokenRepository.tokens[0].usedAt, null, "token is not consumed on failure");
});

test("resetPassword rejects when the account is missing", async () => {
  await recoveryTokenRepository.create({
    userId: "u_ghost",
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });
  await assert.rejects(
    recoveryService.resetPassword({ token: "known-token", newPassword: "NewPass2026!x" }),
    NotFoundError
  );
});

test("resetPassword rejects when the account is inactive", async () => {
  const user = seedUser({ status: "INACTIVE" });
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });
  await assert.rejects(
    recoveryService.resetPassword({ token: "known-token", newPassword: "NewPass2026!x" }),
    ValidationError
  );
});

test("resetPassword rotates the password, bumps tokenVersion and audits", async () => {
  const user = seedUser({ passwordHash: "hash:InitialPass2026!" });
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });

  const result = await recoveryService.resetPassword({
    token: "known-token",
    newPassword: "NewPass2026!x",
    ip: "10.0.0.1",
    userAgent: "unit-test",
    correlationId: "corr_test",
  });
  assert.deepEqual(result, { ok: true });

  const updated = fakes.userRepository.users.get(user.id);
  assert.equal(updated.passwordHash, "hash:NewPass2026!x");
  assert.equal(updated.mustChangePassword, false);
  assert.equal(updated.tokenVersion, 1, "tokenVersion bumped to invalidate existing sessions");
  assert.ok(updated.passwordHistory.includes("hash:InitialPass2026!"));

  const stored = recoveryTokenRepository.tokens[0];
  assert.ok(stored.usedAt, "token marked used");

  const events = auditEvents("AUTH.PASSWORD_RECOVERED");
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "SUCCESS");
  assert.equal(String(events[0].subject.id), user.id);
  assert.equal(events[0].actor.userId, user.id);
  assert.equal(events[0].correlationId, "corr_test");
  assert.equal(events[0].ip, "10.0.0.1");
});

test("resetPassword revokes sessions when a sessionService is wired", async () => {
  const user = seedUser();
  await recoveryTokenRepository.create({
    userId: user.id,
    tokenHash: hashToken("known-token"),
    purpose: RECOVERY_PURPOSE,
    expiresAt: new Date(Date.now() + 900000),
  });

  const revoked = [];
  const serviceWithSessions = new RecoveryService({
    userRepository: fakes.userRepository,
    recoveryTokenRepository,
    passwordHasher: stubHasher,
    passwordService,
    sessionService: { revokeAllForUser: async (userId) => { revoked.push(userId); return 1; } },
    auditService,
    platformSettingRepository: fakes.platformSettingRepository,
  });

  await serviceWithSessions.resetPassword({ token: "known-token", newPassword: "NewPass2026!x" });
  assert.deepEqual(revoked, [user.id]);
});
