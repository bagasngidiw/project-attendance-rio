/**
 * RetentionController — data retention policy + sweep surface (FR-040),
 * guarded by `compliance:manage_retention`.
 */

class RetentionController {
  constructor({ retentionService }) {
    this.retentionService = retentionService;
  }

  /** GET /compliance/retention */
  getPolicy = async (req, res, next) => {
    try {
      const data = await this.retentionService.getPolicy();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /compliance/retention */
  setPolicy = async (req, res, next) => {
    try {
      const data = await this.retentionService.setPolicy(req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /compliance/retention/sweep */
  runSweep = async (req, res, next) => {
    try {
      const data = await this.retentionService.runSweep({
        triggeredBy: this.actor(req).actorId,
      });
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

module.exports = { RetentionController };
