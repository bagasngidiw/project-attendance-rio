/**
 * Routing admin routes (FR-042) — guarded by `platform:settings`.
 */

const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("./auth.routes");

const routingRuleSchema = z.object({
  requestType: z.enum(["LEAVE", "OVERTIME", "TRIP"]),
  levels: z.array(z.object({ source: z.enum(["MANAGER_OF_REQUESTER"]) })).min(1),
  fallback: z.enum(["ACTIVE_HR_ADMIN", "SUPER_ADMIN"]),
  enabled: z.boolean(),
});

const updateRoutingDto = z.object({
  rules: z.array(routingRuleSchema).min(1).max(8),
});

function createRoutingAdminRoutes({ routingAdminController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/routing", authorize("platform:settings"), routingAdminController.getRules);
  router.put(
    "/routing",
    authorize("platform:settings"),
    validate(updateRoutingDto),
    routingAdminController.updateRules
  );

  return router;
}

module.exports = { createRoutingAdminRoutes };
