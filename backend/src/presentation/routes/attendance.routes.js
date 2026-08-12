/**
 * Attendance routes (FR-035 / FR-020 / FR-041). Clock/self endpoints are
 * permission-guarded; the HR overview requires `attendance:view_all`;
 * corrections require `attendance:correct`. Order matters: static paths
 * (`/me`, `/today`) precede the `/ :id` routes.
 */

const { Router } = require("express");
const multer = require("multer");
const { correctDto, clockEventDto } = require("../dto/attendance.dto");
const { validate } = require("./auth.routes");

const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function createAttendanceRoutes({ attendanceController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.post(
    "/clock-in",
    authorize("attendance:clock_in"),
    validate(clockEventDto),
    attendanceController.clockIn
  );
  router.post(
    "/clock-out",
    authorize("attendance:clock_out"),
    validate(clockEventDto),
    attendanceController.clockOut
  );
  // TODO.md FR-008: selfie upload (before clock-in) + secure serving.
  router.post(
    "/media",
    authorize("attendance:clock_in"),
    mediaUpload.single("selfie"),
    attendanceController.uploadMedia
  );
  router.get(
    "/media/:token",
    authorize("attendance:view_own", "attendance:view_all"),
    attendanceController.getMedia
  );
  router.get("/me", authorize("attendance:view_own"), attendanceController.me);
  router.get(
    "/today",
    authorize("attendance:clock_in", "attendance:view_own"),
    attendanceController.today
  );
  router.get("/", authorize("attendance:view_all"), attendanceController.overview);
  router.get(
    "/:id",
    authorize("attendance:view_all", "attendance:view_own"),
    attendanceController.getById
  );
  router.post(
    "/:id/correct",
    authorize("attendance:correct"),
    validate(correctDto),
    attendanceController.correct
  );

  return router;
}

module.exports = { createAttendanceRoutes };
