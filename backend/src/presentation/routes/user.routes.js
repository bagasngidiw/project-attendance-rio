/**
 * User routes (FR-029 / FR-028). `GET /users/me` is authenticated-only
 * (self-scoped); every admin endpoint is guarded by its `users:*` permission.
 */

const { Router } = require("express");
const {
  createUserDto,
  updateUserDto,
  resetPasswordDto,
  workScheduleDto,
  leaveQuotaDto,
} = require("../dto/user.dto");
const { validate } = require("./auth.routes");

function createUserRoutes({ userController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/me", userController.me);
  router.get("/", authorize("users:view"), userController.list);
  router.get("/:id", authorize("users:view"), userController.get);
  router.post(
    "/",
    authorize("users:create"),
    validate(createUserDto),
    userController.create
  );
  router.put(
    "/:id",
    authorize("users:edit"),
    validate(updateUserDto),
    userController.update
  );
  // TODO.md §8/§9: employee work schedule (days + hours).
  router.put(
    "/:id/work-schedule",
    authorize("users:edit"),
    validate(workScheduleDto),
    userController.updateWorkSchedule
  );
  // TODO.md §7: per-leave-type quota allocation.
  router.put(
    "/:id/leave-quota",
    authorize("users:edit"),
    validate(leaveQuotaDto),
    userController.upsertLeaveQuota
  );
  router.post(
    "/:id/deactivate",
    authorize("users:deactivate"),
    userController.deactivate
  );
  router.post(
    "/:id/activate",
    authorize("users:edit"),
    userController.activate
  );
  router.post(
    "/:id/reset-password",
    authorize("users:reset_password"),
    validate(resetPasswordDto),
    userController.resetPassword
  );

  return router;
}

module.exports = { createUserRoutes };
