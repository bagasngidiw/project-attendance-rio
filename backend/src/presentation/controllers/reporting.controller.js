/**
 * ReportingController — reporting-line endpoints (FR-043).
 */

class ReportingController {
  constructor({ reportingLineService }) {
    this.reportingLineService = reportingLineService;
  }

  /** PUT /reporting/users/:id/manager — assign/reassign the manager. */
  assignManager = async (req, res, next) => {
    try {
      const data = await this.reportingLineService.assignManager(
        req.params.id,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /reporting/users/:id/direct-reports — ACTIVE direct reports. */
  directReports = async (req, res, next) => {
    try {
      const data = await this.reportingLineService.getDirectReports(req.params.id);
      res.status(200).json({ data: { items: data } });
    } catch (err) {
      next(err);
    }
  };

  /** GET /reporting/users/:id/manager-history — append-only history. */
  managerHistory = async (req, res, next) => {
    try {
      const data = await this.reportingLineService.getManagerHistory(req.params.id);
      res.status(200).json({ data: { items: data } });
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

module.exports = { ReportingController };
