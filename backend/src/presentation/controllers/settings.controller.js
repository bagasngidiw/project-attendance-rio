/**
 * SettingsController — platform settings surface (FR-032), guarded by
 * `platform:settings` (SUPER_ADMIN only in the seed).
 */

class SettingsController {
  constructor({ settingsService }) {
    this.settingsService = settingsService;
  }

  /** GET /platform/settings — all settings (grouped). */
  getAll = async (req, res, next) => {
    try {
      const data = await this.settingsService.getSettings();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /platform/settings/:key — update a validated setting (audited). */
  updateOne = async (req, res, next) => {
    try {
      const data = await this.settingsService.updateSetting(
        req.params.key,
        req.body.value,
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

module.exports = { SettingsController };
