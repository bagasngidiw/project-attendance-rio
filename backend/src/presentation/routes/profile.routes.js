/**
 * Profile routes (FR-021) — guarded by `profile:view` (GET) and
 * `profile:update` (PUT). Always scoped to the signed-in user.
 */

const { Router } = require("express");
const { updateProfileDto } = require("../dto/profile.dto");
const { validate } = require("./auth.routes");

function createProfileRoutes({ profileController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/me", authorize("profile:view"), profileController.me);
  router.put(
    "/me",
    authorize("profile:update"),
    validate(updateProfileDto),
    profileController.update
  );

  return router;
}

module.exports = { createProfileRoutes };
