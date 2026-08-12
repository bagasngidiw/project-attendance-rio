/**
 * ImportController — bulk user import surface (FR-061), guarded at the route
 * layer by `users:import`.
 */

class ImportController {
  constructor({ importService }) {
    this.importService = importService;
  }

  /** POST /users/import */
  importUsers = async (req, res, next) => {
    try {
      const data = await this.importService.importUsers({
        rawText: req.body.content,
        format: req.body.format,
        actor: this.actor(req),
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

module.exports = { ImportController };
