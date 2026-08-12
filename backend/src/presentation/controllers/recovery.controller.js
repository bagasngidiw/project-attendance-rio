/**
 * RecoveryController — public (unauthenticated) self-service password recovery
 * endpoints (FR-045). Abuse is throttled at the route layer with the rate
 * limiter; the service stays non-revealing about account existence.
 */

class RecoveryController {
  constructor({ recoveryService }) {
    this.recoveryService = recoveryService;
  }

  /** POST /auth/recovery/request */
  request = async (req, res, next) => {
    try {
      const data = await this.recoveryService.requestRecovery({
        identifier: req.body.identifier,
        ...this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /auth/recovery/reset */
  reset = async (req, res, next) => {
    try {
      const data = await this.recoveryService.resetPassword({
        token: req.body.token,
        newPassword: req.body.newPassword,
        ...this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** Public-route context: no authenticated principal, only device metadata. */
  actor(req) {
    return {
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { RecoveryController };
