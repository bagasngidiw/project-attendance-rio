/**
 * Business rule admin routes (FR-046) — guarded by `platform:settings`.
 */

const { Router } = require("express");
const { businessRuleUpdateDto } = require("../dto/business-rule.dto");
const { validate } = require("./auth.routes");

function createBusinessRuleRoutes({ businessRuleController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/:type",
    authorize("platform:settings"),
    businessRuleController.getRules
  );
  router.put(
    "/:type",
    authorize("platform:settings"),
    validate(businessRuleUpdateDto),
    businessRuleController.updateRules
  );

  return router;
}

module.exports = { createBusinessRuleRoutes };
