/**
 * RetentionController tests (FR-040): request → service mapping, status codes,
 * and the actor/error paths.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { RetentionController } = require("../../src/presentation/controllers/retention.controller");
const { createRetentionRoutes } = require("../../src/presentation/routes/retention.routes");
const { retentionPolicyDto } = require("../../src/presentation/dto/retention.dto");
const { ValidationError } = require("../../src/domain/errors");

const authenticate = () => {};
const authorize = () => () => {};

function listRoutes(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route.methods).filter(
        (m) => layer.route.methods[m]
      );
      return `${methods.join("|")} ${layer.route.path}`;
    });
}

function makeHarness({ service } = {}) {
  const controller = new RetentionController({
    retentionService: service ?? {},
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
  const next = (err) => {
    throw err;
  };
  return { controller, res, next };
}

function makeReq(body = {}, params = {}) {
  return {
    auth: { userId: "u_admin", roles: ["SUPER_ADMIN"] },
    body,
    params,
    ip: "127.0.0.1",
    headers: { "user-agent": "test" },
    correlationId: "corr_1",
  };
}

test("getPolicy responds 200 with the policy", async () => {
  const service = { getPolicy: async () => ({ auditEventsDays: 730, usersDays: null }) };
  const { controller, res } = makeHarness({ service });
  await controller.getPolicy(makeReq(), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.auditEventsDays, 730);
});

test("setPolicy passes body + actor and responds 200", async () => {
  let captured = null;
  const service = {
    setPolicy: async (policy, actor) => {
      captured = { policy, actor };
      return { key: "retentionPolicy", value: policy };
    },
  };
  const { controller, res } = makeHarness({ service });
  await controller.setPolicy(makeReq({ auditEventsDays: 90 }), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(captured.policy.auditEventsDays, 90);
  assert.equal(captured.actor.actorId, "u_admin");
  assert.deepEqual(captured.actor.actorRoleKeys, ["SUPER_ADMIN"]);
});

test("runSweep passes triggeredBy and responds 200", async () => {
  let triggeredBy = null;
  const service = {
    runSweep: async ({ triggeredBy: id }) => {
      triggeredBy = id;
      return { job: { status: "COMPLETED" }, summary: { perCategory: {} } };
    },
  };
  const { controller, res } = makeHarness({ service });
  await controller.runSweep(makeReq(), res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(triggeredBy, "u_admin");
  assert.equal(res.body.data.job.status, "COMPLETED");
});

test("handlers forward errors to next", async () => {
  const service = {
    getPolicy: async () => {
      throw new ValidationError("bad", { field: "auditEventsDays" });
    },
  };
  const { controller } = makeHarness({ service });
  const next = (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.details.field, "auditEventsDays");
  };
  await controller.getPolicy(makeReq(), {}, next);
});

test("retentionPolicyDto accepts a valid policy and rejects invalid values", () => {
  const ok = retentionPolicyDto.safeParse({
    auditEventsDays: 90,
    usersDays: null,
    legalHold: [{ type: "USER", id: "u_1" }],
  });
  assert.equal(ok.success, true);
  assert.equal(retentionPolicyDto.safeParse({ auditEventsDays: -1 }).success, false);
  assert.equal(retentionPolicyDto.safeParse({ auditEventsDays: 1.5 }).success, false);
  assert.equal(
    retentionPolicyDto.safeParse({ legalHold: [{ type: "USER" }] }).success,
    false
  );
});

test("createRetentionRoutes registers policy + sweep endpoints behind the guard", () => {
  const controller = {
    getPolicy: async () => {},
    setPolicy: async () => {},
    runSweep: async () => {},
  };
  const router = createRetentionRoutes({ retentionController: controller, authenticate, authorize });
  assert.deepEqual(listRoutes(router), [
    "get /retention",
    "put /retention",
    "post /retention/sweep",
  ]);
  const put = router.stack.find((l) => l.route?.path === "/retention" && l.route.methods.put);
  const handlerNames = put.route.stack.map((h) => h.handle.name || "anon");
  assert.ok(handlerNames.length >= 3, "authenticate + authorize + validate + controller");
});
