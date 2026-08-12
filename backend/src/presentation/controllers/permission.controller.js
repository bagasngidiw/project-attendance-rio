/**
 * PermissionController (FR-007) — Permission (Ijin) submission surface.
 */

class PermissionController {
  constructor({ permissionService }) {
    this.permissionService = permissionService;
  }

  /** POST /permission/requests */
  submit = async (req, res, next) => {
    try {
      const data = await this.permissionService.submit({
        requesterId: req.auth.userId,
        input: req.body,
        actor: this.actor(req),
      });
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

module.exports = { PermissionController };
