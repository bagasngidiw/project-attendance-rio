/**
 * FilterPresetController — saved filter presets surface (FR-047). All
 * endpoints are authenticated and owner-scoped to the signed-in user; no
 * special permission is required.
 */

class FilterPresetController {
  constructor({ filterPresetService }) {
    this.filterPresetService = filterPresetService;
  }

  /** GET /filter-presets?route=&page=&pageSize= — the caller's presets. */
  list = async (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      const data = await this.filterPresetService.listPresets(req.auth.userId, {
        route: req.query.route,
        page,
        pageSize,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /filter-presets — save a new preset for the caller. */
  create = async (req, res, next) => {
    try {
      const data = await this.filterPresetService.createPreset({
        ownerId: req.auth.userId,
        input: req.body,
        actor: this.actor(req),
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PATCH /filter-presets/:id — update an owned preset. */
  update = async (req, res, next) => {
    try {
      const data = await this.filterPresetService.updatePreset({
        id: req.params.id,
        ownerId: req.auth.userId,
        patch: req.body,
        actor: this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** DELETE /filter-presets/:id — remove an owned preset. */
  remove = async (req, res, next) => {
    try {
      const data = await this.filterPresetService.deletePreset({
        id: req.params.id,
        ownerId: req.auth.userId,
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

module.exports = { FilterPresetController };
