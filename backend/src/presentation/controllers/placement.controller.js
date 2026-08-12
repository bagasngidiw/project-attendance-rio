/**
 * Placement controllers (NEW UPDATE TAD SIMBIKA) — admin master management
 * + the public active list consumed by user forms.
 */

class PlacementController {
  constructor({ placementService }) {
    this.placementService = placementService;
  }

  /** GET /placements (active, for forms) */
  listActive = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.placementService.listActive() });
    } catch (err) {
      next(err);
    }
  };

  /** GET /admin/placements?search=&status= */
  listAdmin = async (req, res, next) => {
    try {
      const data = await this.placementService.list({
        search: req.query.search,
        status: req.query.status,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/placements */
  create = async (req, res, next) => {
    try {
      const data = await this.placementService.create(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /admin/placements/:id */
  update = async (req, res, next) => {
    try {
      const data = await this.placementService.update(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/placements/:id/activate */
  activate = async (req, res, next) => {
    try {
      const data = await this.placementService.activate(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/placements/:id/deactivate */
  deactivate = async (req, res, next) => {
    try {
      const data = await this.placementService.deactivate(req.params.id, this.actor(req));
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

module.exports = { PlacementController };
