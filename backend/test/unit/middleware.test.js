/**
 * Middleware unit tests: authenticate, authorize, rate limiter, error mapper.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { JwtTokenProvider } = require("../../src/infrastructure/token-provider");
const {
  createAuthenticate,
  createAuthorize,
} = require("../../src/infrastructure/middleware/auth.middleware");
const { createRateLimiter } = require("../../src/infrastructure/middleware/rate-limiter");
const {
  statusFor,
  toErrorBody,
} = require("../../src/infrastructure/middleware/error-handler.middleware");
const {
  PermissionDeniedError,
  ValidationError,
  ConflictError,
  NotFoundError,
  DomainError,
} = require("../../src/domain/errors");

const TOKEN_OPTS = {
  secret: "test-secret",
  issuer: "hris-platform",
  audience: "hris-web",
  ttlSeconds: 900,
};

function makeToken(overrides = {}) {
  const provider = new JwtTokenProvider(TOKEN_OPTS);
  return provider.sign({
    sub: "u_1",
    email: "jane@corp.io",
    roles: ["EMPLOYEE"],
    permissions: ["dashboard:view", "leave:submit", "attendance:clock_in"],
    ver: 0,
    sessionId: "sess_1",
    ...overrides,
  });
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function mockReq(overrides = {}) {
  return {
    headers: {},
    ip: "127.0.0.1",
    originalUrl: "/api/v1/test",
    method: "GET",
    ...overrides,
  };
}

const sessionServiceStub = {
  async findSessionById() {
    return {
      sessionId: "sess_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastActivityAt: new Date(),
    };
  },
  async assertSessionUsable() {},
};

const userRepositoryStub = {
  async findById() {
    return {
      id: "u_1",
      username: "jane",
      email: "jane@corp.io",
      status: "ACTIVE",
      tokenVersion: 0,
    };
  },
};

test("authenticate attaches principal for a valid token", async () => {
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: userRepositoryStub,
    sessionService: sessionServiceStub,
  });

  const req = mockReq({ headers: { authorization: `Bearer ${makeToken()}` } });
  let called = false;
  await authenticate(req, mockRes(), () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(req.auth.userId, "u_1");
  assert.equal(req.auth.hasPermission("leave:submit"), true);
  assert.equal(req.auth.hasPermission("users:create"), false);
});

test("authenticate rejects a request without a bearer token", async () => {
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: userRepositoryStub,
    sessionService: sessionServiceStub,
  });

  let err;
  await authenticate(mockReq({ headers: {} }), mockRes(), (e) => {
    err = e;
  });
  assert.equal(err.code, "AUTH_UNAUTHENTICATED");
});

test("authenticate rejects an expired/invalid token", async () => {
  // A token signed with a different secret fails signature verification.
  const otherProvider = new JwtTokenProvider({
    ...TOKEN_OPTS,
    secret: "different-secret",
  });
  const invalid = otherProvider.sign({
    sub: "u_1",
    email: "jane@corp.io",
    roles: [],
    permissions: [],
    ver: 0,
    sessionId: "sess_1",
  });

  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: userRepositoryStub,
    sessionService: sessionServiceStub,
  });

  let err;
  await authenticate(
    mockReq({ headers: { authorization: `Bearer ${invalid}` } }),
    mockRes(),
    (e) => {
      err = e;
    }
  );
  assert.equal(err.code, "AUTH_TOKEN_INVALID");
});

test("authenticate rejects when tokenVersion is stale (role change)", async () => {
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: {
      async findById() {
        return { id: "u_1", username: "jane", email: "jane@corp.io", status: "ACTIVE", tokenVersion: 5 };
      },
    },
    sessionService: sessionServiceStub,
  });

  let err;
  await authenticate(
    mockReq({ headers: { authorization: `Bearer ${makeToken({ ver: 0 })}` } }),
    mockRes(),
    (e) => {
      err = e;
    }
  );
  assert.equal(err.code, "AUTH_TOKEN_INVALID");
});

test("authenticate fails closed when the session is missing", async () => {
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: userRepositoryStub,
    sessionService: {
      async findSessionById() {
        // Session record no longer exists (TTL cleanup / DB reset).
        return null;
      },
      async assertSessionUsable() {},
    },
  });

  let err;
  await authenticate(
    mockReq({ headers: { authorization: `Bearer ${makeToken()}` } }),
    mockRes(),
    (e) => {
      err = e;
    }
  );
  assert.equal(err.code, "AUTH_TOKEN_INVALID");
});

test("authenticate enforces the first-sign-in gate when enabled (config toggle)", async () => {
  const gateUserRepo = {
    async findById() {
      return {
        id: "u_1",
        username: "jane",
        email: "jane@corp.io",
        status: "ACTIVE",
        tokenVersion: 0,
        mustChangePassword: true,
      };
    },
  };
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: gateUserRepo,
    sessionService: sessionServiceStub,
    config: { security: { enforceFirstSignInGate: true } },
  });

  const res = mockRes();
  let called = false;
  await authenticate(
    mockReq({
      originalUrl: "/api/v1/navigation",
      path: "/navigation",
      headers: { authorization: `Bearer ${makeToken()}` },
    }),
    res,
    () => {
      called = true;
    }
  );

  assert.equal(called, false, "protected request blocked while mustChangePassword");
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, "PASSWORD_CHANGE_REQUIRED");
});

test("authenticate exempts change-password and session paths from the gate", async () => {
  const gateUserRepo = {
    async findById() {
      return {
        id: "u_1",
        username: "jane",
        email: "jane@corp.io",
        status: "ACTIVE",
        tokenVersion: 0,
        mustChangePassword: true,
      };
    },
  };
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: gateUserRepo,
    sessionService: sessionServiceStub,
    config: { security: { enforceFirstSignInGate: true } },
  });

  let called = false;
  await authenticate(
    mockReq({
      originalUrl: "/api/v1/auth/change-password",
      path: "/change-password",
      headers: { authorization: `Bearer ${makeToken()}` },
    }),
    mockRes(),
    () => {
      called = true;
    }
  );
  assert.equal(called, true, "change-password is reachable while gated");
});

test("authenticate does not gate when the first-sign-in toggle is disabled", async () => {
  const gateUserRepo = {
    async findById() {
      return {
        id: "u_1",
        username: "jane",
        email: "jane@corp.io",
        status: "ACTIVE",
        tokenVersion: 0,
        mustChangePassword: true,
      };
    },
  };
  const authenticate = createAuthenticate({
    tokenProvider: new JwtTokenProvider(TOKEN_OPTS),
    userRepository: gateUserRepo,
    sessionService: sessionServiceStub,
    config: { security: { enforceFirstSignInGate: false } },
  });

  let called = false;
  await authenticate(
    mockReq({
      originalUrl: "/api/v1/navigation",
      path: "/navigation",
      headers: { authorization: `Bearer ${makeToken()}` },
    }),
    mockRes(),
    () => {
      called = true;
    }
  );
  assert.equal(called, true, "gate is off by default");
});

test("authorize allows when permission is granted", async () => {
  const authorize = createAuthorize({ auditService: { record: async () => {} } });
  const req = mockReq({
    auth: { userId: "u_1", permissions: ["leave:submit"], hasPermission: (k) => k === "leave:submit" },
  });
  let nextCalled = false;
  await authorize("leave:submit")(req, mockRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("authorize denies and records audit when permission missing", async () => {
  const recorded = [];
  const authorize = createAuthorize({
    auditService: { record: async (e) => recorded.push(e) },
  });
  const req = mockReq({
    auth: { userId: "u_1", permissions: [], hasPermission: () => false },
  });
  const res = mockRes();
  let err;
  await authorize("users:create")(req, res, (e) => {
    err = e;
  });
  assert.equal(err.code, "AUTH_DENIED");
  assert.equal(recorded[0].action, "AUTH.DENIED");
});

test("authorize requires authentication", async () => {
  const authorize = createAuthorize({ auditService: { record: async () => {} } });
  let err;
  await authorize("dashboard:view")(mockReq({}), mockRes(), (e) => {
    err = e;
  });
  assert.equal(err.code, "AUTH_UNAUTHENTICATED");
});

test("rate limiter blocks requests beyond max and sets headers", async () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  let blocked = false;
  for (let i = 0; i < 5; i++) {
    const res = mockRes();
    await new Promise((resolve) => {
      limiter(mockReq(), res, () => {
        blocked = false;
        resolve();
      });
      if (res.statusCode === 429) {
        blocked = true;
        resolve();
      }
    });
  }
  assert.equal(blocked, true);
});

test("error mapper returns expected HTTP status codes", () => {
  assert.equal(statusFor(new PermissionDeniedError("x")), 403);
  assert.equal(statusFor(new ValidationError("x")), 400);
  assert.equal(statusFor(new ConflictError("x")), 409);
  assert.equal(statusFor(new NotFoundError("x")), 404);
  assert.equal(statusFor(new DomainError("X", "x")), 400);
  assert.equal(statusFor(new Error("boom")), 500);
});

test("error mapper maps Mongoose CastError (malformed id) to 404, not 500", () => {
  // Shape thrown by Mongoose when a `:id` path param cannot be cast to an
  // ObjectId (see GET /rbac/admin/users/:id/effective-permissions).
  const castError = {
    name: "CastError",
    kind: "ObjectId",
    path: "_id",
    message: 'Cast to ObjectId failed for value "6a7393…d671" at path "_id"',
  };
  assert.equal(statusFor(castError), 404);
  const body = toErrorBody(castError);
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(body.message, "Resource not found.");
  // The offending value and driver internals must never leak.
  assert.doesNotMatch(body.message, /6a7393/);
  assert.doesNotMatch(JSON.stringify(body), /ObjectId/);
});

test("error mapper never leaks internal details for unknown errors", () => {
  const body = toErrorBody(new Error("secret internal detail"));
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.doesNotMatch(body.message, /secret/);
});
