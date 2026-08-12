/**
 * Overtime routes (FR-054) — submission guarded by `overtime:submit`.
 */

const { Router } = require("express");
const { overtimeSubmitDto } = require("../dto/overtime.dto");
const { validate } = require("./auth.routes");

function createOvertimeRoutes({ overtimeController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/requests",
    authenticate,
    authorize("overtime:submit"),
    validate(overtimeSubmitDto),
    overtimeController.submit
  );

  return router;
}

module.exports = { createOvertimeRoutes };
