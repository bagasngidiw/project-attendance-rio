/**
 * Recovery routes (FR-045) — public self-service password recovery. No
 * authentication: the endpoints are rate-limited instead so the non-revealing
 * request flow cannot be hammered for user enumeration.
 */

const { Router } = require("express");
const {
  recoveryRequestDto,
  recoveryResetDto,
} = require("../dto/recovery.dto");
const { validate } = require("./auth.routes");

function createRecoveryRoutes({ recoveryController, rateLimit }) {
  const router = Router();

  router.post(
    "/recovery/request",
    rateLimit,
    validate(recoveryRequestDto),
    recoveryController.request
  );

  router.post(
    "/recovery/reset",
    rateLimit,
    validate(recoveryResetDto),
    recoveryController.reset
  );

  return router;
}

module.exports = { createRecoveryRoutes };
