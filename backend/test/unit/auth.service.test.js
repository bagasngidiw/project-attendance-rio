/**
 * AuthService unit tests (FR-001): sign-in success/failure/lockout,
 * refresh rotation & reuse detection, sign-out.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { SessionService } = require("../../src/application/session.service");
const { RbacService } = require("../../src/application/rbac.service");
const { AuthService } = require("../../src/application/auth.service");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { JwtTokenProvider } = require("../../src/infrastructure/token-provider");
const {
  InvalidCredentialsError,
  AccountLockedError,
  AccountInactiveError,
  TokenInvalidError,
  RefreshTokenReuseError,
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

let fakes;
let authService;
let passwordHasher;

beforeEach(async () => {
  fakes = buildFakes();
  passwordHasher = new BcryptPasswordHasher(4);

  // Seed roles + permissions.
  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee" });
  fakes.roleRepository.seed({ id: "r_admin", key: "HR_ADMIN", name: "HR Admin" });
  fakes.permissionRepository.assign("r_employee", [
    "dashboard:view",
    "attendance:clock_in",
    "leave:submit",
    "leave:view_own",
  ]);
  fakes.permissionRepository.assign("r_admin", [
    "dashboard:view",
    "leave:approve",
    "users:create",
    "reporting:view",
  ]);

  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
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

  authService = new AuthService({
    userRepository: fakes.userRepository,
    passwordHasher,
    tokenProvider,
    sessionService,
    rbacService,
    auditService,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    config: SECURITY_CONFIG,
  });

  // Seed an active user with roles.
  const hash = await passwordHasher.hash("Password123!");
  const user = fakes.userRepository.seed({
    id: "u_jane",
    username: "jane",
    email: "jane@corp.io",
    name: "Jane Doe",
    passwordHash: hash,
  });
  fakes.userRoleRepository.assign(user.id, ["r_employee"]);
});

test("signIn succeeds with valid credentials and returns tokens + permissions", async () => {
  const result = await authService.signIn({
    username: "jane",
    password: "Password123!",
    device: { userAgent: "test", ip: "127.0.0.1" },
  });

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.ok(result.sessionId.startsWith("sess_"));
  assert.equal(result.user.username, "jane");
  assert.deepEqual(result.user.roles, ["EMPLOYEE"]);
  assert.ok(result.permissions.includes("attendance:clock_in"));
  assert.ok(result.permissions.includes("leave:view_own"));

  // The access token must carry the owning sessionId claim (design §4.5) so
  // the authenticate middleware can validate the session on every request.
  const payload = JSON.parse(
    Buffer.from(result.accessToken.split(".")[1], "base64url").toString()
  );
  assert.equal(payload.sessionId, result.sessionId);

  // Audit event recorded.
  const events = fakes.auditRepository.entries.filter(
    (e) => e.action === "AUTH.SIGNIN_SUCCESS"
  );
  assert.equal(events.length, 1);
});

test("signIn rejects with generic error for unknown username", async () => {
  await assert.rejects(
    authService.signIn({ username: "ghost", password: "Password123!" }),
    InvalidCredentialsError
  );
  const failures = fakes.auditRepository.entries.filter(
    (e) => e.action === "AUTH.SIGNIN_FAILED"
  );
  assert.equal(failures.length, 1);
});

test("signIn rejects wrong password without revealing which field failed", async () => {
  await assert.rejects(
    authService.signIn({ username: "jane", password: "WrongPassword!" }),
    InvalidCredentialsError
  );
});

test("signIn locks account after threshold failures and rejects while locked", async () => {
  // maxFailedAttempts = 5 → the 5th failure triggers the lockout.
  for (let i = 0; i < 4; i++) {
    await assert.rejects(
      authService.signIn({ username: "jane", password: "Wrong!" }),
      InvalidCredentialsError
    );
  }
  // Fifth failure locks the account.
  await assert.rejects(
    authService.signIn({ username: "jane", password: "Wrong!" }),
    AccountLockedError
  );
  // Even a correct password is rejected while locked.
  await assert.rejects(
    authService.signIn({ username: "jane", password: "Password123!" }),
    AccountLockedError
  );
});

test("signIn rejects INACTIVE accounts", async () => {
  fakes.userRepository.users.get("u_jane").status = "INACTIVE";
  await assert.rejects(
    authService.signIn({ username: "jane", password: "Password123!" }),
    AccountInactiveError
  );
});

test("refresh rotates the token; old token is unusable afterwards", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  const rotated = await authService.refresh({ refreshToken: signIn.refreshToken });
  assert.ok(rotated.accessToken);
  assert.notEqual(rotated.refreshToken, signIn.refreshToken);
  assert.equal(rotated.sessionId, signIn.sessionId);

  // Old token is now used → reuse detection forces re-authentication.
  await assert.rejects(
    authService.refresh({ refreshToken: signIn.refreshToken }),
    RefreshTokenReuseError
  );
});

test("refresh rejects an unknown refresh token", async () => {
  await assert.rejects(
    authService.refresh({ refreshToken: "totally-bogus-token-value" }),
    TokenInvalidError
  );
});

test("getSession validates access token and returns fresh identity + permissions", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  const session = await authService.getSession(signIn.accessToken);
  assert.equal(session.user.id, "u_jane");
  assert.deepEqual(session.roles, ["EMPLOYEE"]);
  assert.ok(session.permissions.includes("leave:submit"));
});

test("getSession rejects a tampered token", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });
  const tampered = signIn.accessToken.slice(0, -2) + "xx";
  await assert.rejects(authService.getSession(tampered), TokenInvalidError);
});

test("getSession rejects tokens whose tokenVersion is out of date", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });
  // Simulate a role change that bumped tokenVersion.
  fakes.userRepository.users.get("u_jane").tokenVersion += 1;
  await assert.rejects(authService.getSession(signIn.accessToken), TokenInvalidError);
});

test("getSession fails closed when the session record is missing", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });

  // Simulate a session that no longer exists (TTL cleanup / DB reset). The
  // token must be rejected instead of silently passing (design §4.2).
  fakes.sessionRepository.sessions.delete(signIn.sessionId);
  await assert.rejects(authService.getSession(signIn.accessToken), TokenInvalidError);
});

test("signOut revokes the session behind the refresh token", async () => {
  const signIn = await authService.signIn({
    username: "jane",
    password: "Password123!",
  });
  await authService.signOut({ refreshToken: signIn.refreshToken });

  await assert.rejects(
    authService.refresh({ refreshToken: signIn.refreshToken }),
    TokenInvalidError
  );
});

test("signOutAll revokes every session", async () => {
  const first = await authService.signIn({ username: "jane", password: "Password123!" });
  const second = await authService.signIn({ username: "jane", password: "Password123!" });

  const revoked = await authService.signOutAll("u_jane", { actorUsername: "jane" });
  assert.equal(revoked, 2);

  await assert.rejects(
    authService.refresh({ refreshToken: first.refreshToken }),
    TokenInvalidError
  );
  await assert.rejects(
    authService.refresh({ refreshToken: second.refreshToken }),
    TokenInvalidError
  );
});
