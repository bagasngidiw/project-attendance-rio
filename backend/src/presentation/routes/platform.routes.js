/**
 * Platform routes (FR-044). Password-policy writes are guarded by
 * `platform:settings` (SUPER_ADMIN only in the seed); the read is relaxed to
 * any authenticated user (FR-003) so the Profile page can render live hints.
 */

const { Router } = require("express");
const { passwordPolicyDto } = require("../dto/platform.dto");
const { validate } = require("./auth.routes");

function createPlatformRoutes({
  platformController,
  settingsController,
  authenticate,
  authorize,
}) {
  const router = Router();

  router.use(authenticate);

  // FR-003: readable by any authenticated user (Profile page shows live
  // password hints via ChangePasswordForm); the write stays superadmin-only.
  router.get(
    "/settings/password-policy",
    platformController.getPasswordPolicy
  );
  router.put(
    "/settings/password-policy",
    authorize("platform:settings"),
    validate(passwordPolicyDto),
    platformController.updatePasswordPolicy
  );

  // FR-032 generic platform settings surface.
  router.get(
    "/settings",
    authorize("platform:settings"),
    settingsController.getAll
  );
  router.put(
    "/settings/:key",
    authorize("platform:settings"),
    settingsController.updateOne
  );

  return router;
}

module.exports = { createPlatformRoutes };
