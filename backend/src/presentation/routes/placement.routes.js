/**
 * Placement routes (NEW UPDATE TAD SIMBIKA).
 * Public active list (authenticated, for user forms) + admin manage
 * (guarded by `platform:settings`).
 */

const { Router } = require("express");
const {
  createPlacementDto,
  updatePlacementDto,
} = require("../dto/placement.dto");
const { validate } = require("./auth.routes");

function createPlacementRoutes({ placementController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);

  router.get("/", placementController.listActive);

  return router;
}

function createPlacementAdminRoutes({ placementController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);
  router.use(authorize("platform:settings"));

  router.get("/", placementController.listAdmin);
  router.post("/", validate(createPlacementDto), placementController.create);
  router.put("/:id", validate(updatePlacementDto), placementController.update);
  router.post("/:id/activate", placementController.activate);
  router.post("/:id/deactivate", placementController.deactivate);

  return router;
}

module.exports = { createPlacementRoutes, createPlacementAdminRoutes };
