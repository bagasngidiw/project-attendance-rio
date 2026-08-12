/**
 * Retention routes (FR-040) — policy reads/writes and sweep trigger, all
 * guarded by `compliance:manage_retention`.
 */

const { Router } = require("express");
const { retentionPolicyDto } = require("../dto/retention.dto");
const { validate } = require("./auth.routes");

function createRetentionRoutes({ retentionController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/retention",
    authorize("compliance:manage_retention"),
    retentionController.getPolicy
  );
  router.put(
    "/retention",
    authorize("compliance:manage_retention"),
    validate(retentionPolicyDto),
    retentionController.setPolicy
  );
  router.post(
    "/retention/sweep",
    authorize("compliance:manage_retention"),
    retentionController.runSweep
  );

  return router;
}

module.exports = { createRetentionRoutes };
