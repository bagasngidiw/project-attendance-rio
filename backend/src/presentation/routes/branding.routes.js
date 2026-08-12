/**
 * Branding routes (FR-001/FR-002/FR-007). Identity/colors/logo management is
 * guarded by `platform:settings`. The branding-asset fetch is public (logos are
 * non-sensitive platform assets served with nosniff + CSP).
 */

const { Router } = require("express");
const multer = require("multer");
const { updateBrandingDto } = require("../dto/branding.dto");
const { validate } = require("./auth.routes");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function createBrandingRoutes({ brandingController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);
  router.use(authorize("platform:settings"));

  router.get("/", brandingController.get);
  router.put("/", validate(updateBrandingDto), brandingController.update);
  router.post("/logo", upload.single("file"), brandingController.uploadLogo);
  router.delete("/logo", brandingController.removeLogo);

  return router;
}

/** Public branding-asset fetch (token is the unguessable storage key). */
function createBrandingAssetRoutes({ brandingController }) {
  const router = Router();
  router.get("/:token", brandingController.getAsset);
  return router;
}

/** Public runtime branding (FR-004): identity + semantic tokens, no auth. */
function createPublicBrandingRoutes({ brandingController }) {
  const router = Router();
  router.get("/", brandingController.getPublic);
  return router;
}

module.exports = { createBrandingRoutes, createBrandingAssetRoutes, createPublicBrandingRoutes };
