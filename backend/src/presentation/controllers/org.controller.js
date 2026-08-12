/**
 * OrgController — departments and positions management (FR-024).
 */

class OrgController {
  constructor({ orgService }) {
    this.orgService = orgService;
  }

  /* ---- Departments ---- */

  listDepartments = async (req, res, next) => {
    try {
      res.status(200).json({ data: { items: await this.orgService.listDepartments() } });
    } catch (err) {
      next(err);
    }
  };

  listActiveDepartments = async (req, res, next) => {
    try {
      res.status(200).json({ data: { items: await this.orgService.listActiveDepartments() } });
    } catch (err) {
      next(err);
    }
  };

  createDepartment = async (req, res, next) => {
    try {
      const data = await this.orgService.createDepartment(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  updateDepartment = async (req, res, next) => {
    try {
      const data = await this.orgService.updateDepartment(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  deactivateDepartment = async (req, res, next) => {
    try {
      const data = await this.orgService.deactivateDepartment(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  activateDepartment = async (req, res, next) => {
    try {
      const data = await this.orgService.activateDepartment(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /* ---- Positions ---- */

  listPositions = async (req, res, next) => {
    try {
      res.status(200).json({ data: { items: await this.orgService.listPositions() } });
    } catch (err) {
      next(err);
    }
  };

  listActivePositions = async (req, res, next) => {
    try {
      res.status(200).json({ data: { items: await this.orgService.listActivePositions() } });
    } catch (err) {
      next(err);
    }
  };

  createPosition = async (req, res, next) => {
    try {
      const data = await this.orgService.createPosition(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  updatePosition = async (req, res, next) => {
    try {
      const data = await this.orgService.updatePosition(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  deactivatePosition = async (req, res, next) => {
    try {
      const data = await this.orgService.deactivatePosition(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  activatePosition = async (req, res, next) => {
    try {
      const data = await this.orgService.activatePosition(req.params.id, this.actor(req));
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

module.exports = { OrgController };
