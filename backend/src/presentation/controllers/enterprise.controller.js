/**
 * EnterpriseController — enterprise configuration surface (FR-039), guarded by
 * `platform:settings`.
 */

class EnterpriseController {
  constructor({ enterpriseService }) {
    this.enterpriseService = enterpriseService;
  }

  /** GET /platform/enterprise */
  getConfig = async (req, res, next) => {
    try {
      const data = await this.enterpriseService.getEnterpriseConfig();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /platform/enterprise */
  setConfig = async (req, res, next) => {
    try {
      const data = await this.enterpriseService.setEnterpriseConfig(
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

module.exports = { EnterpriseController };
