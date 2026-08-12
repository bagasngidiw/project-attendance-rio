/**
 * Personal-data routes (FR-048) — per-user export guarded by
 * `compliance:export_personal_data`.
 */

const { Router } = require("express");

function createPersonalDataRoutes({ personalDataController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/personal-data/:userId/export",
    authorize("compliance:export_personal_data"),
    personalDataController.exportForUser
  );

  return router;
}

module.exports = { createPersonalDataRoutes };
