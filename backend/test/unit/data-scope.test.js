/**
 * Data-scope unit tests (FR-056): domain resolution + scope-guard middleware.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DATA_SCOPES,
  resolveScope,
  scopeSatisfies,
  canAccessTarget,
} = require("../../src/domain/data-scope");
const { createScopeGuard } = require("../../src/infrastructure/middleware/scope-guard.middleware");

/* --------------------------- resolveScope ------------------------------- */

test("resolveScope returns COMPANY for SUPER_ADMIN role", () => {
  assert.equal(
    resolveScope({ permissions: [], roles: ["SUPER_ADMIN"] }),
    DATA_SCOPES.COMPANY
  );
});

test("resolveScope returns COMPANY for the wildcard permission", () => {
  assert.equal(
    resolveScope({ permissions: ["*"], roles: ["EMPLOYEE"] }),
    DATA_SCOPES.COMPANY
  );
});

test("resolveScope returns COMPANY when any view_all permission is held", () => {
  assert.equal(
    resolveScope({ permissions: ["attendance:view_all"], roles: ["MANAGER"] }),
    DATA_SCOPES.COMPANY
  );
  assert.equal(
    resolveScope({ permissions: ["leave:view_all"], roles: ["HR_ADMIN"] }),
    DATA_SCOPES.COMPANY
  );
});

test("resolveScope returns TEAM for team-view permissions", () => {
  assert.equal(
    resolveScope({ permissions: ["team:view_team"], roles: ["MANAGER"] }),
    DATA_SCOPES.TEAM
  );
  assert.equal(
    resolveScope({ permissions: ["team:view_pending"], roles: ["MANAGER"] }),
    DATA_SCOPES.TEAM
  );
});

test("resolveScope returns SELF when no wider permission is held", () => {
  assert.equal(
    resolveScope({ permissions: ["dashboard:view", "leave:submit"], roles: ["EMPLOYEE"] }),
    DATA_SCOPES.SELF
  );
  assert.equal(resolveScope({ permissions: [], roles: [] }), DATA_SCOPES.SELF);
});

/* --------------------------- scopeSatisfies ---------------------------- */

test("scopeSatisfies orders SELF < TEAM < COMPANY", () => {
  assert.equal(scopeSatisfies(DATA_SCOPES.SELF, DATA_SCOPES.SELF), true);
  assert.equal(scopeSatisfies(DATA_SCOPES.TEAM, DATA_SCOPES.SELF), true);
  assert.equal(scopeSatisfies(DATA_SCOPES.COMPANY, DATA_SCOPES.TEAM), true);
  assert.equal(scopeSatisfies(DATA_SCOPES.SELF, DATA_SCOPES.TEAM), false);
  assert.equal(scopeSatisfies(DATA_SCOPES.TEAM, DATA_SCOPES.COMPANY), false);
});

/* --------------------------- canAccessTarget --------------------------- */

test("canAccessTarget with SELF scope only allows the principal themselves", () => {
  const principal = { userId: "u_1", dataScope: DATA_SCOPES.SELF };
  assert.equal(canAccessTarget(principal, { id: "u_1", managerId: "m_9" }), true);
  assert.equal(canAccessTarget(principal, { id: "u_2", managerId: "u_1" }), false);
  assert.equal(canAccessTarget(principal, null), false);
});

test("canAccessTarget with TEAM scope allows direct reports and self", () => {
  const manager = { userId: "m_1", dataScope: DATA_SCOPES.TEAM };
  assert.equal(canAccessTarget(manager, { id: "e_1", managerId: "m_1" }), true);
  assert.equal(canAccessTarget(manager, { id: "m_1", managerId: "bigboss" }), true);
  assert.equal(canAccessTarget(manager, { id: "e_2", managerId: "m_2" }), false);
});

test("canAccessTarget with COMPANY scope allows everyone", () => {
  const admin = { userId: "hr_1", dataScope: DATA_SCOPES.COMPANY };
  assert.equal(canAccessTarget(admin, { id: "e_99", managerId: null }), true);
  assert.equal(canAccessTarget(admin, { id: "hr_1", managerId: null }), true);
});

/* --------------------------- scope-guard middleware -------------------- */

function mockReq(overrides = {}) {
  return {
    params: {},
    headers: { "user-agent": "" },
    ip: "127.0.0.1",
    originalUrl: "/api/v1/test",
    method: "GET",
    correlationId: "corr_test",
    auth: null,
    ...overrides,
  };
}

function mockRes() {
  return {
    statusCode: 200,
    setHeader() {},
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

const userRepositoryStub = {
  async findById(id) {
    const users = {
      u_1: { id: "u_1", managerId: null },
      m_1: { id: "m_1", managerId: null },
      e_1: { id: "e_1", managerId: "m_1" },
      e_2: { id: "e_2", managerId: "m_2" },
    };
    return users[id] ?? null;
  },
};

const auditServiceStub = {
  recorded: [],
  async record(event) {
    this.recorded.push(event);
  },
};

function makeGuard() {
  return createScopeGuard({ userRepository: userRepositoryStub, auditService: auditServiceStub });
}

test("requireScope attaches dataScope and passes when scope satisfies", async () => {
  const { requireScope } = makeGuard();
  const req = mockReq({
    auth: { userId: "m_1", roles: ["MANAGER"], permissions: ["team:view_team"] },
  });
  let called = false;
  await requireScope(DATA_SCOPES.TEAM)(req, mockRes(), () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.auth.dataScope, DATA_SCOPES.TEAM);
});

test("requireScope denies COMPANY-only requests to SELF-scoped users with 403 + audit", async () => {
  const { requireScope } = makeGuard();
  const req = mockReq({
    auth: { userId: "u_1", roles: ["EMPLOYEE"], permissions: ["dashboard:view"] },
  });
  let error = null;
  await requireScope(DATA_SCOPES.COMPANY)(req, mockRes(), (err) => {
    error = err;
  });
  assert.ok(error);
  assert.equal(error.status, 403);
  assert.equal(error.code, "SCOPE_DENIED");
  assert.equal(auditServiceStub.recorded.at(-1).action, "SCOPE.DENIED");
});

test("requireScope requires authentication", async () => {
  const { requireScope } = makeGuard();
  let error = null;
  await requireScope(DATA_SCOPES.SELF)(mockReq({ auth: null }), mockRes(), (err) => {
    error = err;
  });
  assert.ok(error);
  assert.equal(error.code, "AUTH_UNAUTHENTICATED");
});

test("assertInScope passes for a direct report of a TEAM-scoped manager", async () => {
  const { assertInScope } = makeGuard();
  const req = mockReq({
    params: { userId: "e_1" },
    auth: { userId: "m_1", roles: ["MANAGER"], permissions: ["team:view_team"] },
  });
  let called = false;
  await assertInScope()(req, mockRes(), () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.targetUser.id, "e_1");
});

test("assertInScope 404s out-of-scope targets without leaking existence", async () => {
  const { assertInScope } = makeGuard();
  const req = mockReq({
    params: { userId: "e_2" },
    auth: { userId: "m_1", roles: ["MANAGER"], permissions: ["team:view_team"] },
  });
  let error = null;
  await assertInScope()(req, mockRes(), (err) => {
    error = err;
  });
  assert.ok(error);
  assert.equal(error.status, 404);
  assert.equal(error.code, "NOT_FOUND");
  assert.equal(auditServiceStub.recorded.at(-1).action, "SCOPE.DENIED");
});

test("assertInScope 404s unknown target users", async () => {
  const { assertInScope } = makeGuard();
  const req = mockReq({
    params: { userId: "ghost" },
    auth: { userId: "hr_1", roles: ["HR_ADMIN"], permissions: ["users:view"] },
  });
  let error = null;
  await assertInScope()(req, mockRes(), (err) => {
    error = err;
  });
  assert.ok(error);
  assert.equal(error.status, 404);
});
