/**
 * Overtime admin routes (FR-055) — HR overtime review + correction surface,
 * guarded by `overtime:manage`. Mount at `/overtime` so the full paths are
 * `/overtime/admin`, `/overtime/admin/:id`, and `/overtime/admin/:id/correct`.
 */

const { Router } = require("express");
const { overtimeCorrectionDto } = require("../dto/overtime-admin.dto");
const { validate } = require("./auth.routes");

function createOvertimeAdminRoutes({
  overtimeAdminController,
  authenticate,
  authorize,
}) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/admin",
    authorize("overtime:manage"),
    overtimeAdminController.list
  );

  router.get(
    "/admin/:id",
    authorize("overtime:manage"),
    overtimeAdminController.getById
  );

  router.post(
    "/admin/:id/correct",
    authorize("overtime:manage"),
    validate(overtimeCorrectionDto),
    overtimeAdminController.correct
  );

  return router;
}

module.exports = { createOvertimeAdminRoutes };
