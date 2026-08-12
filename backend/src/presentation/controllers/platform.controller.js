/**
 * PlatformController — platform-level settings (FR-044 password policy;
 * extensible for FR-032). All endpoints require `platform:settings`.
 */

class PlatformController {
  constructor({ passwordService }) {
    this.passwordService = passwordService;
  }

  /** GET /platform/settings/password-policy — current policy shape. */
  getPasswordPolicy = async (req, res, next) => {
    try {
      const data = await this.passwordService.getPasswordPolicy();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /platform/settings/password-policy — update policy (audited). */
  updatePasswordPolicy = async (req, res, next) => {
    try {
      const data = await this.passwordService.updatePasswordPolicy(
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

module.exports = { PlatformController };
