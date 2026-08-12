/**
 * Contract-type routes (NEW UPDATE TAD SIMBIKA).
 * Public active list (authenticated, for user forms) + admin manage
 * (guarded by `platform:settings`).
 */

const { Router } = require("express");
const {
  createContractTypeDto,
  updateContractTypeDto,
} = require("../dto/contract-type.dto");
const { validate } = require("./auth.routes");

function createContractTypeRoutes({ contractTypeController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);

  router.get("/", contractTypeController.listActive);

  return router;
}

function createContractTypeAdminRoutes({ contractTypeController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);
  router.use(authorize("platform:settings"));

  router.get("/", contractTypeController.listAdmin);
  router.post("/", validate(createContractTypeDto), contractTypeController.create);
  router.put("/:id", validate(updateContractTypeDto), contractTypeController.update);
  router.post("/:id/activate", contractTypeController.activate);
  router.post("/:id/deactivate", contractTypeController.deactivate);

  return router;
}

module.exports = { createContractTypeRoutes, createContractTypeAdminRoutes };
