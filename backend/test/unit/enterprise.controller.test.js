/**
 * EnterpriseController tests (FR-039): get/set mapping with actor + error path.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { EnterpriseController } = require("../../src/presentation/controllers/enterprise.controller");
const { createEnterpriseRoutes } = require("../../src/presentation/routes/enterprise.routes");
const { enterpriseConfigDto } = require("../../src/presentation/dto/enterprise.dto");
const { ValidationError } = require("../../src/domain/errors");

const authenticate = () => {};
const authorize = () => () => {};

function makeHarness({ service } = {}) {
  const controller = new EnterpriseController({
    enterpriseService: service ?? {},
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

function makeReq(body = {}) {
  return {
    auth: { userId: "u_admin", roles: ["SUPER_ADMIN"] },
    body,
    ip: "127.0.0.1",
    headers: { "user-agent": "test" },
    correlationId: "corr_1",
  };
}

test("getConfig responds 200 with the enterprise config", async () => {
  const service = {
    getEnterpriseConfig: async () => ({
      brand: { companyName: "Acme", logoUrl: "" },
      timezone: "UTC",
      defaults: {},
    }),
  };
  const { controller, res } = makeHarness({ service });
  await controller.getConfig(makeReq(), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.brand.companyName, "Acme");
});

test("setConfig passes body + actor and responds 200", async () => {
  let captured = null;
  const service = {
    setEnterpriseConfig: async (config, actor) => {
      captured = { config, actor };
      return { key: "enterprise", value: config };
    },
  };
  const { controller, res } = makeHarness({ service });
  await controller.setConfig(makeReq({ brand: { companyName: "Acme" } }), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(captured.config.brand.companyName, "Acme");
  assert.equal(captured.actor.actorId, "u_admin");
});

test("handlers forward errors to next", async () => {
  const service = {
    setEnterpriseConfig: async () => {
      throw new ValidationError("bad", { field: "brand" });
    },
  };
  const { controller } = makeHarness({ service });
  const next = (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.details.field, "brand");
  };
  await controller.setConfig(makeReq({}), {}, next);
});

test("enterpriseConfigDto accepts a valid config and rejects invalid values", () => {
  const ok = enterpriseConfigDto.safeParse({
    brand: { companyName: "Acme", logoUrl: "https://x/logo.png" },
    timezone: "Asia/Tokyo",
    defaults: { workingDays: ["MON"] },
  });
  assert.equal(ok.success, true);
  assert.equal(enterpriseConfigDto.safeParse({ timezone: 123 }).success, false);
  assert.equal(enterpriseConfigDto.safeParse({ brand: { companyName: 42 } }).success, false);
});

test("createEnterpriseRoutes registers the enterprise endpoints behind the guard", () => {
  const router = createEnterpriseRoutes({
    enterpriseController: { getConfig: async () => {}, setConfig: async () => {} },
    authenticate,
    authorize,
  });
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route.methods).filter(
        (m) => layer.route.methods[m]
      );
      return `${methods.join("|")} ${layer.route.path}`;
    });
  assert.deepEqual(routes, ["get /enterprise", "put /enterprise"]);
});
