/**
 * TripController — business trip submission surface (FR-054), guarded by
 * `trip:submit`.
 */

class TripController {
  constructor({ tripService }) {
    this.tripService = tripService;
  }

  /** POST /trip/requests */
  submit = async (req, res, next) => {
    try {
      const data = await this.tripService.submit({
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

module.exports = { TripController };
