/**
 * Leave-type admin routes (FR-058) — guarded by `platform:settings`.
 */

const { Router } = require("express");
const { createLeaveTypeDto, updateLeaveTypeDto } = require("../dto/leave-type.dto");
const { validate } = require("./auth.routes");

function createLeaveTypeAdminRoutes({ leaveTypeController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/", authorize("platform:settings"), leaveTypeController.listAll);
  router.post(
    "/",
    authorize("platform:settings"),
    validate(createLeaveTypeDto),
    leaveTypeController.create
  );
  router.put(
    "/:id",
    authorize("platform:settings"),
    validate(updateLeaveTypeDto),
    leaveTypeController.update
  );
  router.post("/:id/deactivate", authorize("platform:settings"), leaveTypeController.deactivate);
  router.post("/:id/activate", authorize("platform:settings"), leaveTypeController.activate);

  return router;
}

module.exports = { createLeaveTypeAdminRoutes };
