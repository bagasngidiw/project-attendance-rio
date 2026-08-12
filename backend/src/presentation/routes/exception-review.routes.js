/**
 * Exception review routes (FR-053) — manager team exception review surface,
 * guarded by `attendance:review_exceptions`. Mount at `/attendance` so the
 * full paths are `/attendance/team/exceptions` and
 * `/attendance/team/exceptions/:attendanceId/review`.
 */

const { Router } = require("express");
const { exceptionReviewDto } = require("../dto/exception-review.dto");
const { validate } = require("./auth.routes");

function createExceptionReviewRoutes({
  exceptionReviewController,
  authenticate,
  authorize,
}) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/team/exceptions",
    authorize("attendance:review_exceptions"),
    exceptionReviewController.listTeamExceptions
  );

  router.post(
    "/team/exceptions/:attendanceId/review",
    authorize("attendance:review_exceptions"),
    validate(exceptionReviewDto),
    exceptionReviewController.recordReview
  );

  return router;
}

module.exports = { createExceptionReviewRoutes };
