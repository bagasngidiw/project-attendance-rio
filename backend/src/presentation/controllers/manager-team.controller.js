/**
 * ManagerTeamController — team overview endpoints (FR-006, design §5.1).
 *
 * All endpoints are manager-scoped: the acting user (from `req.auth`) is the
 * manager whose direct reports are returned. `authorize` middleware enforces
 * the `team:view_team` / `team:view_pending` permissions before these run.
 */

const { ValidationError } = require("../../domain/errors");
const { teamOverviewQueryDto, teamMemberParamsDto } = require("../dto/team.dto");

class ManagerTeamController {
  constructor({ managerTeamService }) {
    this.managerTeamService = managerTeamService;
  }

  /** GET /api/v1/manager/team — team members + pending request summary. */
  teamOverview = async (req, res, next) => {
    try {
      const parsed = teamOverviewQueryDto.safeParse(req.query);
      if (!parsed.success) {
        throw new ValidationError("Invalid team overview query.", {
          issues: parsed.error.issues,
        });
      }

      const data = await this.managerTeamService.getTeamOverview(
        req.auth.userId,
        {
          actorRoleKeys: req.auth.roles,
          correlationId: req.correlationId,
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
        }
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /api/v1/manager/team/:memberId — scope-bound member detail. */
  teamMember = async (req, res, next) => {
    try {
      const parsed = teamMemberParamsDto.safeParse(req.params);
      if (!parsed.success) {
        throw new ValidationError("Invalid team member reference.", {
          issues: parsed.error.issues,
        });
      }

      const data = await this.managerTeamService.getTeamMember(
        req.auth.userId,
        parsed.data.memberId,
        {
          actorRoleKeys: req.auth.roles,
          correlationId: req.correlationId,
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
        }
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { ManagerTeamController };
