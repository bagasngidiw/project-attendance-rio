/**
 * MfaController (FR-051) — self-service TOTP enrollment for elevated roles.
 * All endpoints require `mfa:manage`, enforced at the route layer.
 */

class MfaController {
  constructor({ mfaService }) {
    this.mfaService = mfaService;
  }

  /** GET /mfa/enroll — begins enrollment; returns secret + provisioning URI. */
  enroll = async (req, res, next) => {
    try {
      const data = await this.mfaService.enroll({ userId: req.auth.userId });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /mfa/confirm — validates a code and enables MFA (audited). */
  confirm = async (req, res, next) => {
    try {
      const data = await this.mfaService.confirmEnrollment({
        userId: req.auth.userId,
        code: req.body.code,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /mfa/disable — disables MFA for the caller (audited). */
  disable = async (req, res, next) => {
    try {
      const data = await this.mfaService.disable({
        userId: req.auth.userId,
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

module.exports = { MfaController };
