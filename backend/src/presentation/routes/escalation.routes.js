/**
 * Escalation routes (FR-009/FR-063): config read/write and the sweep are
 * guarded by platform:settings (platform administration).
 */

const { Router } = require("express");

function createEscalationRoutes({ escalationController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/escalation-config",
    authorize("platform:settings"),
    escalationController.getConfig
  );
  router.put(
    "/escalation-config",
    authorize("platform:settings"),
    escalationController.updateConfig
  );
  router.post(
    "/escalation/check",
    authorize("platform:settings"),
    escalationController.runSweep
  );

  return router;
}

module.exports = { createEscalationRoutes };
