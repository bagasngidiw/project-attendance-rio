/**
 * ApprovalController — inbox, unified list, decisions, drill-down, escalation,
 * blocked-reason, and history (FR-007 / FR-008 / FR-063).
 */

const { approvalQuerySchema } = require("../dto/approval.dto");

class ApprovalController {
  constructor({ approvalService }) {
    this.approvalService = approvalService;
  }

  /** GET /approvals/inbox — PENDING requests assigned to the caller. */
  inbox = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.approvalService.listInbox(req.auth.userId, filters);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /approvals — unified single-approver inbox (FR-063 U.4): PENDING
   * requests in the caller's scope with shared *:approve gating.
   */
  unified = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.approvalService.listUnified(this.actor(req), filters);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /approvals/:id — request drill-down (payload + history). */
  drillDown = async (req, res, next) => {
    try {
      const data = await this.approvalService.getDrillDown(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /approvals/:id/decide — approve or reject an assigned request. */
  decide = async (req, res, next) => {
    try {
      const data = await this.approvalService.decide(
        req.params.id,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /approvals/:id/escalate — requester/approver escalates a PENDING request. */
  escalate = async (req, res, next) => {
    try {
      const data = await this.approvalService.escalate(
        req.params.id,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /approvals/blocked-reason/:id — cutoff/calendar block reason. */
  blockedReason = async (req, res, next) => {
    try {
      const data = await this.approvalService.getBlockedReason(
        req.params.id,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /approvals/history — decided requests in the caller's scope. */
  history = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.approvalService.listHistoryUnified(this.actor(req), filters);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  parseFilters(query) {
    const parsed = approvalQuerySchema.safeParse(query);
    if (!parsed.success) {
      const { ValidationError } = require("../../domain/errors");
      throw new ValidationError("Invalid query filters.", {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

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

module.exports = { ApprovalController };
