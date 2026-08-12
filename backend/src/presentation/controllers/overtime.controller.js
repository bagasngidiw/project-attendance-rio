/**
 * OvertimeController — overtime submission surface (FR-054), guarded by
 * `overtime:submit`.
 */

class OvertimeController {
  constructor({ overtimeService }) {
    this.overtimeService = overtimeService;
  }

  /** POST /overtime/requests */
  submit = async (req, res, next) => {
    try {
      const data = await this.overtimeService.submit({
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

module.exports = { OvertimeController };
