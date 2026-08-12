/**
 * PersonalDataController tests (FR-048): export mapping, bundle payload, and
 * the error path.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { PersonalDataController } = require("../../src/presentation/controllers/personal-data.controller");
const { createPersonalDataRoutes } = require("../../src/presentation/routes/personal-data.routes");
const { NotFoundError } = require("../../src/domain/errors");

const authenticate = () => {};
const authorize = () => () => {};

function makeHarness({ service } = {}) {
  const controller = new PersonalDataController({
    personalDataService: service ?? {},
  });
  const res = { statusCode: null, body: null };
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (body) {
    this.body = body;
    return this;
  };
  return { controller, res };
}

function makeReq(params = {}) {
  return {
    auth: { userId: "u_admin", roles: ["HR_COMPLIANCE"] },
    params,
    ip: "127.0.0.1",
    headers: { "user-agent": "test" },
    correlationId: "corr_1",
  };
}

test("exportForUser responds 200 with the bundle", async () => {
  const bundle = { profile: { id: "u_emp", username: "jane" }, roles: [], exportedAt: "x" };
  const service = {
    exportForUser: async ({ userId, actor }) => ({ bundle, json: () => "{}" }),
  };
  const { controller, res } = makeHarness({ service });
  await controller.exportForUser(makeReq({ userId: "u_emp" }), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.profile.username, "jane");
});

test("exportForUser forwards unknown-user errors to next", async () => {
  const service = {
    exportForUser: async () => {
      throw new NotFoundError("User not found.", "USER_NOT_FOUND");
    },
  };
  const { controller } = makeHarness({ service });
  const next = (err) => {
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.code, "USER_NOT_FOUND");
  };
  await controller.exportForUser(makeReq({ userId: "u_missing" }), {}, next);
});

test("createPersonalDataRoutes registers the export endpoint behind the guard", () => {
  const router = createPersonalDataRoutes({
    personalDataController: { exportForUser: async () => {} },
    authenticate,
    authorize,
  });
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);
  assert.deepEqual(routes, ["/personal-data/:userId/export"]);
});
