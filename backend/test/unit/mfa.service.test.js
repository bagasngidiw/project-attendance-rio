/**
 * MfaService tests (FR-051): enroll/confirm/disable + audit events,
 * challenge pass/fail + audit events, challenge-token round-trip, policy
 * gating, and the signIn MFA hook (including the no-MFA regression).
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { SessionService } = require("../../src/application/session.service");
const { RbacService } = require("../../src/application/rbac.service");
const { AuthService } = require("../../src/application/auth.service");
const { MfaService } = require("../../src/application/mfa.service");
const { totpCode } = require("../../src/domain/mfa");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { JwtTokenProvider } = require("../../src/infrastructure/token-provider");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
  TokenInvalidError,
} = require("../../src/domain/errors");

const SECURITY_CONFIG = {
  jwtSecret: "test-secret",
  jwtIssuer: "hris-platform",
  jwtAudience: "hris-web",
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  bcryptRounds: 4,
  maxFailedAttempts: 5,
  lockoutMs: 15 * 60 * 1000,
  sessionInactivityMs: 30 * 60 * 1000,
};

/** In-memory MFA repository port (no MongoDB in unit tests). */
class InMemoryMfaRepository {
  constructor() {
    this.records = new Map();
  }

  async findByUserId(userId) {
    return this.records.get(String(userId)) ?? null;
  }

  async upsert(userId, { secret, enabled, confirmedAt, disabledAt } = {}) {
    const record = {
      ...(this.records.get(String(userId)) ?? {}),
      userId: String(userId),
    };
    if (secret !== undefined) record.secret = secret;
    if (enabled !== undefined) record.enabled = enabled;
    if (confirmedAt !== undefined) record.confirmedAt = confirmedAt;
    if (disabledAt !== undefined) record.disabledAt = disabledAt;
    this.records.set(record.userId, record);
    return record;
  }

  async deleteByUserId(userId) {
    this.records.delete(String(userId));
  }
}

async function buildEnv({ withMfa = true } = {}) {
  const fakes = buildFakes();

  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee" });
  fakes.roleRepository.seed({ id: "r_admin", key: "SUPER_ADMIN", name: "Super Admin" });
  fakes.permissionRepository.assign("r_employee", ["dashboard:view", "leave:submit"]);
  fakes.permissionRepository.assign("r_admin", [
    "dashboard:view",
    "users:create",
    "mfa:manage",
  ]);

  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: {
      verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }),
    },
  });
  const sessionService = new SessionService({
    sessionRepository: fakes.sessionRepository,
    refreshTokenRepository: fakes.refreshTokenRepository,
    config: SECURITY_CONFIG,
  });
  const rbacService = new RbacService({
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    permissionRepository: fakes.permissionRepository,
    auditService,
  });
  const tokenProvider = new JwtTokenProvider({
    secret: SECURITY_CONFIG.jwtSecret,
    issuer: SECURITY_CONFIG.jwtIssuer,
    audience: SECURITY_CONFIG.jwtAudience,
    ttlSeconds: SECURITY_CONFIG.accessTokenTtlSeconds,
  });
  const passwordHasher = new BcryptPasswordHasher(4);

  const mfaService = new MfaService({
    mfaRepository: new InMemoryMfaRepository(),
    userRepository: fakes.userRepository,
    tokenProvider,
    sessionService,
    auditService,
    platformSettingRepository: fakes.platformSettingRepository,
    config: SECURITY_CONFIG,
  });

  const authService = new AuthService({
    userRepository: fakes.userRepository,
    passwordHasher,
    tokenProvider,
    sessionService,
    rbacService,
    auditService,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    passwordService: null,
    mfaService: withMfa ? mfaService : null,
    config: SECURITY_CONFIG,
  });

  async function seedUser({ id = "u_jane", username = "jane", roleId = "r_admin" } = {}) {
    const hash = await passwordHasher.hash("Password123!");
    const user = fakes.userRepository.seed({
      id,
      username,
      email: `${username}@corp.io`,
      name: "Jane Doe",
      passwordHash: hash,
    });
    fakes.userRoleRepository.assign(user.id, [roleId]);
    return user;
  }

  async function enableMfaFor(user) {
    const { secret } = await mfaService.enroll({ userId: user.id });
    await mfaService.confirmEnrollment({ userId: user.id, code: totpCode(secret, {}) });
    return { secret };
  }

  return {
    fakes,
    mfaService,
    authService,
    sessionService,
    tokenProvider,
    seedUser,
    enableMfaFor,
  };
}

let env;

beforeEach(async () => {
  env = await buildEnv();
});

test("getConfig returns the disabled default when mfaRequirements is unset", async () => {
  assert.deepEqual(await env.mfaService.getConfig(), {
    enabled: false,
    requiredForRoles: [],
  });
});

test("getConfig reads and normalizes the stored mfaRequirements setting", async () => {
  await env.fakes.platformSettingRepository.set("mfaRequirements", {
    enabled: true,
    requiredForRoles: ["super_admin"],
  });
  assert.deepEqual(await env.mfaService.getConfig(), {
    enabled: true,
    requiredForRoles: ["SUPER_ADMIN"],
  });
});

test("isRequiredForRoles returns false when the policy is disabled", async () => {
  await env.fakes.platformSettingRepository.set("mfaRequirements", {
    enabled: false,
    requiredForRoles: ["SUPER_ADMIN"],
  });
  assert.equal(await env.mfaService.isRequiredForRoles(["SUPER_ADMIN"]), false);
});

test("isRequiredForRoles honors an enabled policy and matching roles", async () => {
  await env.fakes.platformSettingRepository.set("mfaRequirements", {
    enabled: true,
    requiredForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
  });
  assert.equal(await env.mfaService.isRequiredForRoles(["SUPER_ADMIN"]), true);
  assert.equal(await env.mfaService.isRequiredForRoles(["hr_admin"]), true);
  assert.equal(await env.mfaService.isRequiredForRoles(["EMPLOYEE"]), false);
  assert.equal(await env.mfaService.isRequiredForRoles([]), false);
});

test("enroll generates a secret, persists an unconfirmed record and returns provisioning data", async () => {
  const user = await env.seedUser();

  const result = await env.mfaService.enroll({ userId: user.id });

  assert.equal(result.secret.length, 32);
  assert.match(result.secret, /^[A-Z2-7]{32}$/);
  assert.ok(result.otpAuthUri.startsWith("otpauth://totp/"));
  assert.ok(result.otpAuthUri.includes(user.username));
  assert.equal(result.qrCodeDataUrl, null);

  const record = env.mfaService.mfaRepository.records.get(String(user.id));
  assert.equal(record.secret, result.secret);
  assert.equal(record.enabled, false);
  assert.equal(record.confirmedAt, null);
});

test("enroll rejects with ConflictError when MFA is already enabled", async () => {
  const user = await env.seedUser();
  await env.enableMfaFor(user);

  await assert.rejects(env.mfaService.enroll({ userId: user.id }), ConflictError);
});

test("confirmEnrollment enables MFA with a valid code and audits MFA.ENROLLED", async () => {
  const user = await env.seedUser();
  const { secret } = await env.mfaService.enroll({ userId: user.id });
  const code = totpCode(secret, {});

  const result = await env.mfaService.confirmEnrollment({ userId: user.id, code });

  assert.equal(result.enabled, true);
  assert.ok(result.confirmedAt instanceof Date);
  const record = env.mfaService.mfaRepository.records.get(String(user.id));
  assert.equal(record.enabled, true);
  assert.ok(record.confirmedAt);

  const audit = env.fakes.auditRepository.entries.find(
    (e) => e.action === "MFA.ENROLLED"
  );
  assert.ok(audit, "MFA.ENROLLED recorded");
  assert.equal(audit.outcome, "SUCCESS");
  assert.equal(audit.actor.userId, user.id);
});

test("confirmEnrollment rejects an invalid code and leaves MFA disabled", async () => {
  const user = await env.seedUser();
  await env.mfaService.enroll({ userId: user.id });

  await assert.rejects(
    env.mfaService.confirmEnrollment({ userId: user.id, code: "000000" }),
    ValidationError
  );
  assert.equal(env.mfaService.mfaRepository.records.get(String(user.id)).enabled, false);
});

test("confirmEnrollment throws NotFound when the user never enrolled", async () => {
  await assert.rejects(
    env.mfaService.confirmEnrollment({ userId: "u_nobody", code: "123456" }),
    NotFoundError
  );
});

test("disable turns MFA off, stamps disabledAt and audits MFA.DISABLED", async () => {
  const user = await env.seedUser();
  await env.enableMfaFor(user);

  const result = await env.mfaService.disable({
    userId: user.id,
    actor: { actorId: user.id, actorRoleKeys: ["SUPER_ADMIN"] },
  });

  assert.equal(result.enabled, false);
  assert.ok(result.disabledAt instanceof Date);
  const record = env.mfaService.mfaRepository.records.get(String(user.id));
  assert.equal(record.enabled, false);
  assert.ok(record.disabledAt);

  const audit = env.fakes.auditRepository.entries.find(
    (e) => e.action === "MFA.DISABLED"
  );
  assert.ok(audit, "MFA.DISABLED recorded");
  assert.equal(audit.outcome, "SUCCESS");
  assert.equal(audit.actor.userId, user.id);
});

test("disable throws NotFound when the user never enrolled", async () => {
  await assert.rejects(env.mfaService.disable({ userId: "u_nobody" }), NotFoundError);
});

test("challenge returns true for a valid code and audits MFA.CHALLENGE_PASSED", async () => {
  const user = await env.seedUser();
  const { secret } = await env.enableMfaFor(user);

  const passed = await env.mfaService.challenge({
    userId: user.id,
    code: totpCode(secret, {}),
  });
  assert.equal(passed, true);

  const audit = env.fakes.auditRepository.entries.find(
    (e) => e.action === "MFA.CHALLENGE_PASSED"
  );
  assert.ok(audit, "MFA.CHALLENGE_PASSED recorded");
  assert.equal(audit.outcome, "SUCCESS");
});

test("challenge returns false for a wrong code and audits MFA.CHALLENGE_FAILED", async () => {
  const user = await env.seedUser();
  await env.enableMfaFor(user);

  const passed = await env.mfaService.challenge({ userId: user.id, code: "000000" });
  assert.equal(passed, false);

  const audit = env.fakes.auditRepository.entries.find(
    (e) => e.action === "MFA.CHALLENGE_FAILED"
  );
  assert.ok(audit, "MFA.CHALLENGE_FAILED recorded");
  assert.equal(audit.outcome, "FAILURE");
});

test("challenge fails closed for disabled or missing enrollments", async () => {
  const user = await env.seedUser();
  const { secret } = await env.enableMfaFor(user);
  await env.mfaService.disable({ userId: user.id });

  assert.equal(
    await env.mfaService.challenge({ userId: user.id, code: totpCode(secret, {}) }),
    false
  );
  assert.equal(
    await env.mfaService.challenge({ userId: "u_nobody", code: totpCode(secret, {}) }),
    false
  );
});

test("issueChallengeToken round-trips through verifyChallengeToken", async () => {
  const user = await env.seedUser();

  const token = env.mfaService.issueChallengeToken({ userId: user.id });
  assert.ok(typeof token === "string" && token.includes("."));

  const decoded = env.mfaService.verifyChallengeToken(token);
  assert.deepEqual(decoded, { userId: String(user.id) });
});

test("challenge token carries the purpose claim and a 5-minute lifetime", async () => {
  const user = await env.seedUser();
  const token = env.mfaService.issueChallengeToken({ userId: user.id });

  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  );
  assert.equal(payload.purpose, "mfa-challenge");
  assert.equal(payload.ver, 0);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.exp - payload.iat, 300);
});

test("verifyChallengeToken rejects a tampered token", async () => {
  const user = await env.seedUser();
  const token = env.mfaService.issueChallengeToken({ userId: user.id });
  const tampered = token.slice(0, -3) + "abc";

  assert.throws(() => env.mfaService.verifyChallengeToken(tampered), TokenInvalidError);
});

test("verifyChallengeToken rejects garbage input", async () => {
  assert.throws(() => env.mfaService.verifyChallengeToken("not-a-jwt"), TokenInvalidError);
});

test("verifyChallengeToken rejects an access token signed for another purpose", async () => {
  const user = await env.seedUser();
  const accessToken = await env.tokenProvider.sign({
    sub: user.id,
    email: user.email,
    roles: ["SUPER_ADMIN"],
    permissions: ["mfa:manage"],
    ver: 0,
    sessionId: "sess_123",
  });

  assert.throws(
    () => env.mfaService.verifyChallengeToken(accessToken),
    TokenInvalidError
  );
});

test("signIn returns tokens normally when mfaService is absent (regression)", async () => {
  const noMfa = await buildEnv({ withMfa: false });
  await noMfa.seedUser({ roleId: "r_employee" });

  const result = await noMfa.authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.ok(result.sessionId.startsWith("sess_"));
  assert.equal(result.user.username, "jane");
  assert.ok(!("mfaRequired" in result));
});

test("signIn pauses for MFA when the policy applies and the user is enrolled", async () => {
  await env.fakes.platformSettingRepository.set("mfaRequirements", {
    enabled: true,
    requiredForRoles: ["SUPER_ADMIN"],
  });
  const user = await env.seedUser();
  await env.enableMfaFor(user);

  const result = await env.authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  assert.equal(result.mfaRequired, true);
  assert.ok(result.mfaChallengeToken);
  assert.ok(!("accessToken" in result));
  assert.ok(!("refreshToken" in result));
  assert.ok(!("sessionId" in result));

  // No session was opened and no sign-in success was recorded.
  assert.equal(env.fakes.sessionRepository.sessions.size, 0);
  const success = env.fakes.auditRepository.entries.filter(
    (e) => e.action === "AUTH.SIGNIN_SUCCESS"
  );
  assert.equal(success.length, 0);

  // The challenge token completes the flow.
  const { userId } = env.mfaService.verifyChallengeToken(result.mfaChallengeToken);
  assert.equal(userId, String(user.id));
});

test("signIn issues tokens normally when the user is not enrolled in MFA", async () => {
  await env.fakes.platformSettingRepository.set("mfaRequirements", {
    enabled: true,
    requiredForRoles: ["SUPER_ADMIN"],
  });
  await env.seedUser();

  const result = await env.authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  assert.ok(result.accessToken);
  assert.equal(result.mfaRequired, undefined);
});

test("signIn issues tokens normally when the MFA policy is disabled", async () => {
  const user = await env.seedUser();
  await env.enableMfaFor(user);

  const result = await env.authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  assert.ok(result.accessToken);
  assert.equal(result.mfaRequired, undefined);
});

test("completeMfaSignIn issues the same session/token bundle as a normal sign-in", async () => {
  const user = await env.seedUser();

  const result = await env.authService.completeMfaSignIn({
    userId: user.id,
    device: { userAgent: "test", ip: "127.0.0.1" },
  });

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.ok(result.sessionId.startsWith("sess_"));
  assert.deepEqual(result.user.roles, ["SUPER_ADMIN"]);
  assert.ok(result.permissions.includes("users:create"));

  const payload = JSON.parse(
    Buffer.from(result.accessToken.split(".")[1], "base64url").toString()
  );
  assert.equal(payload.sessionId, result.sessionId);

  const success = env.fakes.auditRepository.entries.filter(
    (e) => e.action === "AUTH.SIGNIN_SUCCESS"
  );
  assert.equal(success.length, 1);
});

test("completeMfaSignIn fails closed for a missing or inactive user", async () => {
  await assert.rejects(
    env.authService.completeMfaSignIn({ userId: "u_ghost" }),
    TokenInvalidError
  );

  const user = await env.seedUser();
  env.fakes.userRepository.users.get(user.id).status = "INACTIVE";
  await assert.rejects(
    env.authService.completeMfaSignIn({ userId: user.id }),
    TokenInvalidError
  );
});
