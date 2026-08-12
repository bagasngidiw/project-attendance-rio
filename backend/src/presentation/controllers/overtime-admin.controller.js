/**
 * OvertimeAdminController — HR administrative overtime review and correction
 * (FR-055), guarded by `overtime:manage`.
 */

const { ValidationError } = require("../../domain/errors");
const { overtimeAdminQueryDto } = require("../dto/overtime-admin.dto");

class OvertimeAdminController {
  constructor({ overtimeAdminService }) {
    this.overtimeAdminService = overtimeAdminService;
  }

  /** GET /overtime/admin — filtered overtime request overview. */
  list = async (req, res, next) => {
    try {
      const parsed = overtimeAdminQueryDto.safeParse(req.query);
      if (!parsed.success) {
        throw new ValidationError("Invalid query filters.", {
          issues: parsed.error.issues,
        });
      }

      const data = await this.overtimeAdminService.listOverviews(parsed.data);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /overtime/admin/:id — scoped overtime detail + correction history. */
  getById = async (req, res, next) => {
    try {
      const data = await this.overtimeAdminService.getById(req.params.id);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /overtime/admin/:id/correct — append-only overtime correction. */
  correct = async (req, res, next) => {
    try {
      const data = await this.overtimeAdminService.correct(
        { overtimeId: req.params.id, ...req.body },
        this.actor(req)
      );
      res.status(200).json({ data });
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

module.exports = { OvertimeAdminController };
