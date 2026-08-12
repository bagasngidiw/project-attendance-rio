/**
 * Contract-type controllers (NEW UPDATE TAD SIMBIKA) — admin master management
 * + the public active list consumed by user forms.
 */

class ContractTypeController {
  constructor({ contractTypeService }) {
    this.contractTypeService = contractTypeService;
  }

  /** GET /contract-types (active, for forms) */
  listActive = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.contractTypeService.listActive() });
    } catch (err) {
      next(err);
    }
  };

  /** GET /admin/contract-types?search=&status= */
  listAdmin = async (req, res, next) => {
    try {
      const data = await this.contractTypeService.list({
        search: req.query.search,
        status: req.query.status,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/contract-types */
  create = async (req, res, next) => {
    try {
      const data = await this.contractTypeService.create(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /admin/contract-types/:id */
  update = async (req, res, next) => {
    try {
      const data = await this.contractTypeService.update(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/contract-types/:id/activate */
  activate = async (req, res, next) => {
    try {
      const data = await this.contractTypeService.activate(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /admin/contract-types/:id/deactivate */
  deactivate = async (req, res, next) => {
    try {
      const data = await this.contractTypeService.deactivate(req.params.id, this.actor(req));
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

module.exports = { ContractTypeController };
