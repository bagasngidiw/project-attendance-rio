/**
 * Enterprise routes (FR-039) — enterprise/tenant configuration guarded by
 * `platform:settings`.
 */

const { Router } = require("express");
const { enterpriseConfigDto } = require("../dto/enterprise.dto");
const { validate } = require("./auth.routes");

function createEnterpriseRoutes({ enterpriseController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/enterprise",
    authorize("platform:settings"),
    enterpriseController.getConfig
  );
  router.put(
    "/enterprise",
    authorize("platform:settings"),
    validate(enterpriseConfigDto),
    enterpriseController.setConfig
  );

  return router;
}

module.exports = { createEnterpriseRoutes };
