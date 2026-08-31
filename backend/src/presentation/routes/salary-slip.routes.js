/**
 * Salary-slip routes (FR-006) — SUPERADMIN uploads slips (`salary:manage`);
 * employees list/download their own (`salary:view_own`). Uploads use in-memory
 * multer storage capped at 10 MB; the service enforces the 5 MB + MIME policy.
 * The DTO validates the multipart text fields; file bytes are multer-only.
 */

const { Router } = require("express");
const multer = require("multer");

const { validate } = require("./auth.routes");
const { salarySlipCreateDto } = require("../dto/salary-slip.dto");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createSalarySlipRoutes({ salarySlipController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/",
    authenticate,
    authorize("salary:manage"),
    upload.single("file"),
    // multer must run first to populate the multipart text fields in req.body.
    validate(salarySlipCreateDto),
    salarySlipController.upload
  );

  router.get(
    "/mine",
    authenticate,
    authorize("salary:view_own"),
    salarySlipController.listMine
  );

  router.get(
    "/",
    authenticate,
    authorize("salary:manage"),
    salarySlipController.listAll
  );

  router.get(
    "/:id/download",
    authenticate,
    authorize("salary:view_own", "salary:manage"),
    salarySlipController.download
  );

  return router;
}

module.exports = { createSalarySlipRoutes };