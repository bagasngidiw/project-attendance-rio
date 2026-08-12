/**
 * LeaveTypeController — leave-type configuration (FR-058) + active list for
 * the submission form.
 */

class LeaveTypeController {
  constructor({ leaveTypeService }) {
    this.leaveTypeService = leaveTypeService;
  }

  listActive = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.listActive();
      res.status(200).json({ data: { items: data } });
    } catch (err) {
      next(err);
    }
  };

  listAll = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.listAll();
      res.status(200).json({ data: { items: data } });
    } catch (err) {
      next(err);
    }
  };

  create = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.create(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** TODO.md §6 "Tambahkan sendiri" — requester suggests a new Cuti type. */
  suggest = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.suggest(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  update = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.update(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  deactivate = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.deactivate(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  activate = async (req, res, next) => {
    try {
      const data = await this.leaveTypeService.activate(req.params.id, this.actor(req));
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

module.exports = { LeaveTypeController };
