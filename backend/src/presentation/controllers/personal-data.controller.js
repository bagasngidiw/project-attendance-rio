/**
 * PersonalDataController — compliance data export surface (FR-048), guarded by
 * `compliance:export_personal_data`.
 */

class PersonalDataController {
  constructor({ personalDataService }) {
    this.personalDataService = personalDataService;
  }

  /** GET /compliance/personal-data/:userId/export */
  exportForUser = async (req, res, next) => {
    try {
      const result = await this.personalDataService.exportForUser({
        userId: req.params.userId,
        actor: this.actor(req),
      });
      res.status(200).json({ data: result.bundle });
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

module.exports = { PersonalDataController };
