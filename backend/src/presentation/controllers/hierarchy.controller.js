class HierarchyController {
  constructor({ hierarchyService }) {
    this.hierarchyService = hierarchyService;
  }

  list = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.list(req.filters) });
    } catch (err) {
      next(err);
    }
  };

  placements = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.listPlacements(req.query.contractTypeId) });
    } catch (err) {
      next(err);
    }
  };

  create = async (req, res, next) => {
    try {
      const data = await this.hierarchyService.create(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  get = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.getById(req.params.id) });
    } catch (err) {
      next(err);
    }
  };

  eligibleUsers = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.eligibleUsers(req.params.id, req.query) });
    } catch (err) {
      next(err);
    }
  };

  addNode = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.addNode(req.params.id, req.body, this.actor(req)) });
    } catch (err) {
      next(err);
    }
  };

  removeNode = async (req, res, next) => {
    try {
      res.status(200).json({
        data: await this.hierarchyService.removeNode(req.params.id, req.params.nodeId, req.body, this.actor(req)),
      });
    } catch (err) {
      next(err);
    }
  };

  activate = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.activate(req.params.id, req.body.expectedVersion, this.actor(req)) });
    } catch (err) {
      next(err);
    }
  };

  archive = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.archive(req.params.id, req.body.expectedVersion, this.actor(req)) });
    } catch (err) {
      next(err);
    }
  };

  history = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.hierarchyService.history(req.params.id) });
    } catch (err) {
      next(err);
    }
  };

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      actorPermissions: req.auth.permissions,
      correlationId: req.correlationId,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
    };
  }
}

module.exports = { HierarchyController };
