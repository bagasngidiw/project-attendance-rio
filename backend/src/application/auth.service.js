/**
 * AuthService — sign-in, refresh, sign-out, session (FR-001).
 *
 * Coordinates domain rules, password hashing, token issuance and session
 * management. Emits audit events for every security-relevant step.
 */

const {
  InvalidCredentialsError,
  AccountInactiveError,
  AccountLockedError,
  TokenInvalidError,
} = require("../domain/errors");

class AuthService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/password-hasher').BcryptPasswordHasher} deps.passwordHasher
   * @param {import('../infrastructure/token-provider').JwtTokenProvider} deps.tokenProvider
   * @param {import('./session.service').SessionService} deps.sessionService
   * @param {import('./rbac.service').RbacService} deps.rbacService
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('./password.service').PasswordService} [deps.passwordService] optional (FR-044 expiry surfacing)
   * @param {object} deps.config security config
   */
  constructor({
    userRepository,
    passwordHasher,
    tokenProvider,
    sessionService,
    rbacService,
    auditService,
    roleRepository,
    userRoleRepository,
    passwordService = null,
    mfaService = null,
    config,
  }) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.tokenProvider = tokenProvider;
    this.sessionService = sessionService;
    this.rbacService = rbacService;
    this.auditService = auditService;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.passwordService = passwordService;
    this.mfaService = mfaService;
    this.config = config;
  }

  /** Resolves password-expiry state (false when no policy service is wired). */
  async computePasswordExpired(user) {
    if (!this.passwordService) return false;
    return this.passwordService.isPasswordExpired(user);
  }

  signToken(user, roles, permissions, sessionId) {
    return this.tokenProvider.sign({
      sub: user.id,
      email: user.email,
      roles,
      permissions,
      ver: user.tokenVersion,
      sessionId,
    });
  }

  /**
   * Signs a user in with username + password (design §4.1).
   *
   * @param {{ username: string, password: string, device?: { userAgent: string, ip: string } }} input
   * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string, expiresIn: number, user: object, permissions: string[] }>}
   */
  async signIn({ username, password, device = { userAgent: "", ip: "" } }) {
    const context = { username, ip: device.ip, userAgent: device.userAgent };

    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      await this.recordFailure(context, "unknown user");
      throw new InvalidCredentialsError();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const retryAfterMs = user.lockedUntil.getTime() - Date.now();
      await this.auditService.record({
        action: "AUTH.LOCKOUT",
        actor: { userId: user.id, roleKeys: [] },
        subject: { type: "USER", id: user.id, summary: user.username },
        outcome: "FAILURE",
        metadata: { retryAfterMs, reason: "account locked" },
        correlationId: device.correlationId,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      throw new AccountLockedError(retryAfterMs);
    }

    if (user.status !== "ACTIVE") {
      await this.auditService.record({
        action: "AUTH.SIGNIN_FAILED",
        actor: { userId: user.id, roleKeys: [] },
        subject: { type: "USER", id: user.id, summary: user.username },
        outcome: "FAILURE",
        metadata: { reason: `status ${user.status}` },
        correlationId: device.correlationId,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      throw new AccountInactiveError();
    }

    const passwordOk = await this.passwordHasher.verify(
      password,
      user.passwordHash
    );
    if (!passwordOk) {
      const result = await this.userRepository.recordFailedLogin(
        user,
        this.config.maxFailedAttempts,
        this.config.lockoutMs
      );
      await this.auditService.record({
        action: "AUTH.SIGNIN_FAILED",
        actor: { userId: user.id, roleKeys: [] },
        subject: { type: "USER", id: user.id, summary: user.username },
        outcome: "FAILURE",
        metadata: {
          reason: "bad password",
          attempts: result.user.failedLoginAttempts,
          locked: result.locked,
        },
        correlationId: device.correlationId,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      if (result.locked) {
        throw new AccountLockedError(result.retryAfterMs);
      }
      throw new InvalidCredentialsError();
    }

    await this.userRepository.resetFailedLogin(user);
    const roles = await this.loadRoleKeys(user.id);

    // FR-051: an enabled MFA policy for the user's roles pauses sign-in until
    // the challenge passes. No session or tokens are issued on this leg.
    if (await this.shouldRequireMfa(user.id, roles)) {
      return {
        mfaRequired: true,
        mfaChallengeToken: await this.mfaService.issueChallengeToken({
          userId: user.id,
        }),
      };
    }

    const permissions = await this.rbacService.getEffectivePermissions(user.id);
    const passwordExpired = await this.computePasswordExpired(user);

    const { sessionId, refreshToken } = await this.sessionService.openSession({
      userId: user.id,
      device,
    });

    const accessToken = await this.tokenProvider.sign({
      sub: user.id,
      email: user.email,
      roles,
      permissions,
      ver: user.tokenVersion,
      sessionId,
    });

    await this.auditService.record({
      action: "AUTH.SIGNIN_SUCCESS",
      actor: { userId: user.id, roleKeys: roles },
      subject: { type: "USER", id: user.id, summary: user.username },
      outcome: "SUCCESS",
      metadata: { sessionId },
      correlationId: device.correlationId,
      ip: device.ip,
      userAgent: device.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
      expiresIn: this.tokenProvider.ttlSeconds,
      user: this.toUserDto(user, roles, passwordExpired),
      permissions,
    };
  }

  /**
   * Whether a sign-in must be paused for an MFA challenge (FR-051). Always
   * false when no MFA service is wired, so existing deployments are
   * unaffected.
   *
   * @param {string} userId
   * @param {string[]} roles
   * @returns {Promise<boolean>}
   */
  async shouldRequireMfa(userId, roles) {
    if (!this.mfaService) return false;
    if (!(await this.mfaService.isEnabledForUser(userId))) return false;
    return this.mfaService.isRequiredForRoles(roles);
  }

  /**
   * Completes an MFA-gated sign-in: verifies the user is still active and
   * issues the same session/token bundle a normal sign-in would (FR-051).
   *
   * @param {{ userId: string, device?: { userAgent: string, ip: string } }} input
   * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string, expiresIn: number, user: object, permissions: string[] }>}
   */
  async completeMfaSignIn({ userId, device = { userAgent: "", ip: "" } }) {
    const user = await this.userRepository.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new TokenInvalidError("User no longer active.");
    }

    const permissions = await this.rbacService.getEffectivePermissions(user.id);
    const roles = await this.loadRoleKeys(user.id);
    const passwordExpired = await this.computePasswordExpired(user);

    const { sessionId, refreshToken } = await this.sessionService.openSession({
      userId: user.id,
      device,
    });

    const accessToken = await this.tokenProvider.sign({
      sub: user.id,
      email: user.email,
      roles,
      permissions,
      ver: user.tokenVersion,
      sessionId,
    });

    await this.auditService.record({
      action: "AUTH.SIGNIN_SUCCESS",
      actor: { userId: user.id, roleKeys: roles },
      subject: { type: "USER", id: user.id, summary: user.username },
      outcome: "SUCCESS",
      metadata: { sessionId },
      correlationId: device.correlationId,
      ip: device.ip,
      userAgent: device.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
      expiresIn: this.tokenProvider.ttlSeconds,
      user: this.toUserDto(user, roles, passwordExpired),
      permissions,
    };
  }

  /**
   * Rotates a refresh token and returns a new access token (design §4.3).
   *
   * @param {{ refreshToken: string, device?: object }} input
   */
  async refresh({ refreshToken, device = { userAgent: "", ip: "" } }) {
    const { newRefreshToken, tokenDoc } =
      await this.sessionService.rotateRefreshToken(refreshToken);

    const user = await this.userRepository.findById(tokenDoc.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new TokenInvalidError("User no longer active.");
    }

    const permissions = await this.rbacService.getEffectivePermissions(user.id);
    const roles = await this.loadRoleKeys(user.id);
    const accessToken = await this.tokenProvider.sign({
      sub: user.id,
      email: user.email,
      roles,
      permissions,
      ver: user.tokenVersion,
      sessionId: tokenDoc.sessionId,
    });

    await this.auditService.record({
      action: "AUTH.REFRESH_ROTATED",
      actor: { userId: user.id, roleKeys: roles },
      subject: { type: "SESSION", id: tokenDoc.sessionId },
      outcome: "SUCCESS",
      metadata: { sessionId: tokenDoc.sessionId },
      correlationId: device.correlationId,
      ip: device.ip,
      userAgent: device.userAgent,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      sessionId: tokenDoc.sessionId,
      expiresIn: this.tokenProvider.ttlSeconds,
    };
  }

  /**
   * Validates a session token and returns current identity + permissions.
   *
   * @param {string} accessToken
   * @returns {Promise<{ user: object, permissions: string[], roles: string[] }>}
   */
  async getSession(accessToken) {
    let payload;
    try {
      payload = this.tokenProvider.verify(accessToken);
    } catch {
      throw new TokenInvalidError();
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user || user.status !== "ACTIVE") {
      throw new TokenInvalidError("User no longer active.");
    }
    if (user.tokenVersion !== payload.ver) {
      // Roles/permissions changed since this token was issued.
      throw new TokenInvalidError("Session token superseded.");
    }

    const session = await this.sessionService.findSessionById(
      payload.sessionId
    );
    if (!session) {
      // Fail closed: a session that no longer exists invalidates the token.
      throw new TokenInvalidError("Session not found.");
    }
    await this.sessionService.assertSessionUsable(session);

    const permissions = await this.rbacService.getEffectivePermissions(user.id);
    const roles = await this.loadRoleKeys(user.id);
    const passwordExpired = await this.computePasswordExpired(user);

    return {
      user: this.toUserDto(user, roles, passwordExpired),
      permissions,
      roles,
    };
  }

  /**
   * Revokes the session behind a refresh token on explicit sign-out.
   *
   * @param {{ refreshToken: string }} input
   */
  async signOut({ refreshToken }) {
    const tokenDoc = await this.sessionService.validateRefreshToken(refreshToken);
    await this.sessionService.revokeSession(tokenDoc.sessionId);

    const user = await this.userRepository.findById(tokenDoc.userId);
    await this.auditService.record({
      action: "AUTH.SIGNOUT",
      actor: { userId: tokenDoc.userId, roleKeys: [] },
      subject: { type: "SESSION", id: tokenDoc.sessionId },
      outcome: "SUCCESS",
      metadata: { sessionId: tokenDoc.sessionId },
    });
  }

  /**
   * Revokes every session for the current user (sign-out-all).
   *
   * @param {string} userId
   * @param {{ actorUsername?: string }} context
   */
  async signOutAll(userId, context = {}) {
    const count = await this.sessionService.revokeAllForUser(userId);
    await this.auditService.record({
      action: "AUTH.SIGNOUT_ALL",
      actor: { userId, roleKeys: [] },
      subject: { type: "USER", id: userId },
      outcome: "SUCCESS",
      metadata: { revokedSessions: count },
    });
    return count;
  }

  /** Loads the role keys assigned to a user (for the identity DTO). */
  async loadRoleKeys(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    const roles = await this.roleRepository.findByIds(roleIds);
    return roles.map((role) => role.key);
  }

  /** Records a failed sign-in attempt for audit. */
  async recordFailure(context, reason) {
    await this.auditService.record({
      action: "AUTH.SIGNIN_FAILED",
      actor: null,
      subject: { type: "USER", summary: context.username ?? "" },
      outcome: "FAILURE",
      metadata: { reason },
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  /** Maps a user document to the public identity DTO. */
  toUserDto(user, roles, passwordExpired = false) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      passwordExpired,
      roles,
    };
  }
}

module.exports = { AuthService };
