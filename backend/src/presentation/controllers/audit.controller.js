/**
 * AuditController — audit + activity log surfaces (FR-012 / FR-013,
 * design §5.1). All endpoints require `audit:view`; scoping (HR admin sees
 * only own actions) is applied by the service.
 */

const { z } = require("zod");
const { ValidationError } = require("../../domain/errors");

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  module: z.string().optional(),
  subjectType: z.string().optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  correlationId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function parseFilters(query) {
  const result = querySchema.safeParse(query);
  if (!result.success) {
    throw new ValidationError("Invalid query filters.", {
      issues: result.error.issues,
    });
  }
  const { page, pageSize, ...rest } = result.data;
  return { filters: rest, page, pageSize };
}

/**
 * Resolves the actor scope: SUPER_ADMIN sees everything; other roles with
 * `audit:view` see only their own actions (design §5.1 note).
 */
function resolveScope(req) {
  const isSuperAdmin = req.auth.roles.includes("SUPER_ADMIN");
  return { actorId: isSuperAdmin ? null : req.auth.userId };
}

class AuditController {
  constructor({ auditService }) {
    this.auditService = auditService;
  }

  listEvents = async (req, res, next) => {
    try {
      const { filters, page, pageSize } = parseFilters(req.query);
      const data = await this.auditService.queryAuditEvents(
        { ...filters, page, pageSize },
        resolveScope(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  getEvent = async (req, res, next) => {
    try {
      const data = await this.auditService.getAuditEvent(req.params.id);
      if (!data) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Audit event not found." },
        });
        return;
      }
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  verifyChain = async (req, res, next) => {
    try {
      const data = await this.auditService.verifyChain();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  listActivity = async (req, res, next) => {
    try {
      const { filters, page, pageSize } = parseFilters(req.query);
      const data = await this.auditService.queryActivityRecords(
        { ...filters, page, pageSize },
        resolveScope(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  exportEvents = async (req, res, next) => {
    try {
      const { filters } = parseFilters(req.query);
      const csv = await this.auditService.exportAuditEvents(filters, resolveScope(req));

      // Record the export itself as an activity + audit event (FR-018 governance).
      await this.auditService.record({
        action: "REPORT.EXPORTED",
        actor: { userId: req.auth.userId, roleKeys: req.auth.roles },
        subject: { type: "REPORT", summary: "audit-events-export" },
        outcome: "SUCCESS",
        metadata: { format: "csv", rows: csv.split("\n").length - 1 },
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-events.csv"');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { AuditController };
