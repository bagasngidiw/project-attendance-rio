/**
 * DashboardController — personal and HR dashboard summaries (FR-025 / FR-026).
 */

const { hrFiltersSchema } = require("../dto/dashboard.dto");
const { ValidationError } = require("../../domain/errors");

class DashboardController {
  constructor({ dashboardService }) {
    this.dashboardService = dashboardService;
  }

  /** GET /dashboard/me — personal summary (scoped to the signed-in user). */
  me = async (req, res, next) => {
    try {
      const data = await this.dashboardService.getPersonalSummary(req.auth.userId, {
        permissions: req.auth.permissions,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /dashboard/hr — HR statistics summary (HR scope required). */
  hr = async (req, res, next) => {
    try {
      const parsed = hrFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError("Invalid dashboard filters.", {
          issues: parsed.error.issues,
        }));
        return;
      }
      const data = await this.dashboardService.getHrSummary({
        permissions: req.auth.permissions,
        filters: parsed.data,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { DashboardController };
