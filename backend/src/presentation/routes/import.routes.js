/**
 * Import routes (FR-061) — `POST /users/import` guarded by `users:import`.
 * Body is JSON-encoded `{ format, content }`; no multipart uploads.
 */

const { Router } = require("express");
const { importUsersDto } = require("../dto/import.dto");
const { validate } = require("./auth.routes");

function createImportRoutes({ importController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.post(
    "/import",
    authorize("users:import"),
    validate(importUsersDto),
    importController.importUsers
  );

  return router;
}

module.exports = { createImportRoutes };
