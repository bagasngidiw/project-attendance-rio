/**
 * Sickness-type controllers (TODO.md §5/§6) — admin master management + the
 * public list + the "Tambahkan sendiri" suggestion surface.
 */

class SicknessTypeController {
  constructor({ sicknessTypeService }) {
    this.sicknessTypeService = sicknessTypeService;
  }

  /** GET /sickness-types (active, for forms) */
  listActive = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.sicknessTypeService.listActive() });
    } catch (err) {
      next(err);
    }
  };

  /** GET /admin/sickness-types?search=&status= */
  listAdmin = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.list({
        search: req.query.search,
        status: req.query.status,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/sickness-types */
  create = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.create(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /admin/sickness-types/:id */
  update = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.update(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/sickness-types/:id/activate */
  activate = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.activate(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/sickness-types/:id/deactivate */
  deactivate = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.deactivate(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /sickness-types/suggest (requester "Tambahkan sendiri"). */
  suggest = async (req, res, next) => {
    try {
      const data = await this.sicknessTypeService.suggest(req.body, this.actor(req));
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

module.exports = { SicknessTypeController };
