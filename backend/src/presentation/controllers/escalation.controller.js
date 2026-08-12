/**
 * EscalationController — escalation configuration + sweep (FR-009/FR-063).
 */

const { z } = require("zod");

const escalationConfigSchema = z.object({
  maxPendingDays: z.number().int().min(1),
  notifyApprover: z.boolean().optional(),
});

class EscalationController {
  constructor({ escalationService }) {
    this.escalationService = escalationService;
  }

  /** GET /approvals/escalation-config */
  getConfig = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.escalationService.getConfig() });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /approvals/escalation-config */
  updateConfig = async (req, res, next) => {
    try {
      const parsed = escalationConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        const { ValidationError } = require("../../domain/errors");
        return next(new ValidationError("Invalid escalation config.", { issues: parsed.error.issues }));
      }
      const data = await this.escalationService.updateConfig(parsed.data, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /approvals/escalation/check — run the stale-pending sweep. */
  runSweep = async (req, res, next) => {
    try {
      const data = await this.escalationService.checkPendingRequests();
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

module.exports = { EscalationController };
