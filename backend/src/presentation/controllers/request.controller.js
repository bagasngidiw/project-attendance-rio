/**
 * RequestController — shared request surface (FR-016): my history, scoped
 * detail with timeline, and cancellation. Requester scope is enforced in the
 * service (404 for non-owners — no existence leak). FR-002 adds the shared
 * approval engine surface: claim / approve / reject / approval-history.
 */

const { mineQuerySchema } = require("../dto/request.dto");

class RequestController {
  constructor({ requestService, approvalService, approvalEngine = null }) {
    this.requestService = requestService;
    this.approvalService = approvalService;
    this.approvalEngine = approvalEngine;
  }

  /** GET /requests/mine — the caller's own requests with filters + pagination. */
  mine = async (req, res, next) => {
    try {
      const parsed = mineQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const { ValidationError } = require("../../domain/errors");
        next(new ValidationError("Invalid query filters.", { issues: parsed.error.issues }));
        return;
      }
      const data = await this.requestService.listMine(req.auth.userId, parsed.data);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /requests/:id — scoped detail + history timeline. */
  getById = async (req, res, next) => {
    try {
      const data = await this.requestService.getByIdScoped(req.params.id, req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /requests/:id — edit a PENDING request payload (FR-052). */
  edit = async (req, res, next) => {
    try {
      const data = await this.requestService.editPendingRequest({
        requestId: req.params.id,
        requesterId: req.auth.userId,
        payload: req.body.payload,
        actor: this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /requests/:id/cancel — cancel own PENDING request. */
  cancel = async (req, res, next) => {
    try {
      const data = await this.requestService.cancelRequest({
        requestId: req.params.id,
        requesterId: req.auth.userId,
        reason: req.body.reason ?? "",
        actor: this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /requests/:id/history — timeline for requester, approver, or HR (FR-008). */
  history = async (req, res, next) => {
    try {
      const data = await this.approvalService.getHistoryScoped(req.params.id, {
        actorId: req.auth.userId,
        actorRoleKeys: req.auth.roles,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /requests/:id/claim — atomically claim a role-targeted request (FR-002). */
  claim = async (req, res, next) => {
    try {
      const data = await this.approvalEngine.claimApproval(
        req.params.id,
        req.auth.userId,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /requests/:id/approve — approve the assigned request (FR-002). */
  approve = async (req, res, next) => {
    try {
      const data = await this.approvalEngine.approve(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /requests/:id/reject — reject with a mandatory reason (FR-002). */
  reject = async (req, res, next) => {
    try {
      const data = await this.approvalEngine.reject(
        req.params.id,
        req.body.reason ?? "",
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /requests/:id/approval-history — append-only approval timeline (FR-002). */
  approvalHistory = async (req, res, next) => {
    try {
      const data = await this.approvalEngine.getApprovalHistory(req.params.id, {
        actorId: req.auth.userId,
        actorRoleKeys: req.auth.roles,
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
      actorPermissions: req.auth.permissions,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { RequestController };
