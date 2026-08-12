/**
 * ProfileController — employee self-service profile (FR-021): read own
 * profile and update self-service fields.
 */

class ProfileController {
  constructor({ profileService }) {
    this.profileService = profileService;
  }

  /** GET /profile/me — the caller's full profile. */
  me = async (req, res, next) => {
    try {
      const data = await this.profileService.getMyProfile(req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /profile/me — update self-service fields only. */
  update = async (req, res, next) => {
    try {
      const data = await this.profileService.updateMyProfile(
        req.auth.userId,
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

module.exports = { ProfileController };
