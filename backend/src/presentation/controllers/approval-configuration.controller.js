/**
 * ApprovalConfigurationController (FR-001) — Superadmin configuration surface.
 */

class ApprovalConfigurationController {
  constructor({ approvalConfigurationService }) {
    this.approvalConfigurationService = approvalConfigurationService;
  }

  /** GET /approval-configurations */
  list = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.approvalConfigurationService.getConfigurations() });
    } catch (err) {
      next(err);
    }
  };

  /** GET /approval-configurations/:requestType */
  get = async (req, res, next) => {
    try {
      const data = await this.approvalConfigurationService.getConfiguration(req.params.requestType);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /approval-configurations/:requestType */
  update = async (req, res, next) => {
    try {
      const data = await this.approvalConfigurationService.updateConfiguration(
        req.params.requestType,
        req.body,
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

module.exports = { ApprovalConfigurationController };
