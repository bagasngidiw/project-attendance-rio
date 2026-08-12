/**
 * RoutingAdminController — FR-042 routing-rule configuration surface,
 * guarded by `platform:settings` (SUPER_ADMIN only in the seed).
 */

class RoutingAdminController {
  constructor({ routingService }) {
    this.routingService = routingService;
  }

  /** GET /admin/routing — current routing rules per request type. */
  getRules = async (req, res, next) => {
    try {
      const data = await this.routingService.listRules();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /admin/routing — replace routing rules (audited). */
  updateRules = async (req, res, next) => {
    try {
      const data = await this.routingService.saveRules(req.body.rules, this.actor(req));
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

module.exports = { RoutingAdminController };
