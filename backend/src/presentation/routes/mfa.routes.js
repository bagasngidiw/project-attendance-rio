/**
 * MFA routes (FR-051) — TOTP enrollment, confirmation and disable. All
 * guarded by `mfa:manage` (elevated/self-service roles in the seed).
 */

const { Router } = require("express");
const { mfaConfirmDto } = require("../dto/mfa.dto");
const { validate } = require("./auth.routes");

function createMfaRoutes({ mfaController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/enroll", authorize("mfa:manage"), mfaController.enroll);
  router.post(
    "/confirm",
    authorize("mfa:manage"),
    validate(mfaConfirmDto),
    mfaController.confirm
  );
  router.post("/disable", authorize("mfa:manage"), mfaController.disable);

  return router;
}

module.exports = { createMfaRoutes };
