/**
 * Permission routes (FR-007) — submission guarded by `permission:submit`.
 * Approval actions reuse the shared claim/approve/reject surface.
 */

const { Router } = require("express");
const { permissionSubmitDto } = require("../dto/permission.dto");
const { validate } = require("./auth.routes");

function createPermissionRoutes({ permissionController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/requests",
    authenticate,
    authorize("permission:submit"),
    validate(permissionSubmitDto),
    permissionController.submit
  );

  return router;
}

module.exports = { createPermissionRoutes };
