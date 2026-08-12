/**
 * ExceptionReviewController — Manager review of team attendance exceptions
 * (FR-053). Both endpoints are manager-scoped (the acting user from
 * `req.auth` is the manager) and guarded by `attendance:review_exceptions`.
 */

const { ValidationError } = require("../../domain/errors");
const { exceptionTeamQueryDto } = require("../dto/exception-review.dto");

class ExceptionReviewController {
  constructor({ exceptionReviewService }) {
    this.exceptionReviewService = exceptionReviewService;
  }

  /** GET /attendance/team/exceptions — exception records of direct reports. */
  listTeamExceptions = async (req, res, next) => {
    try {
      const parsed = exceptionTeamQueryDto.safeParse(req.query);
      if (!parsed.success) {
        throw new ValidationError("Invalid query filters.", {
          issues: parsed.error.issues,
        });
      }

      const data = await this.exceptionReviewService.listTeamExceptions({
        managerId: req.auth.userId,
        ...parsed.data,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /attendance/team/exceptions/:attendanceId/review — append a review. */
  recordReview = async (req, res, next) => {
    try {
      const data = await this.exceptionReviewService.recordReview(
        {
          attendanceId: req.params.attendanceId,
          reviewerId: req.auth.userId,
          outcome: req.body.outcome,
          comment: req.body.comment,
        },
        this.actor(req)
      );
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { ExceptionReviewController };
