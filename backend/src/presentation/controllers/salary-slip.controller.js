/**
 * SalarySlipController (FR-006) — salary invoice slip upload/list/download.
 * Route-level authorization is `salary:manage` / `salary:view_own`; ownership
 * and manager checks are re-enforced inside the service (defense in depth).
 */

const { salarySlipListQuerySchema } = require("../dto/salary-slip.dto");
const { ValidationError } = require("../../domain/errors");

class SalarySlipController {
  constructor({ salarySlipService }) {
    this.salarySlipService = salarySlipService;
  }

  /** POST /salary-slips (multipart: userId, payDate, periodLabel, notes?, file) */
  upload = async (req, res, next) => {
    try {
      if (!req.file) {
        next(new ValidationError("A file is required.", { field: "file" }));
        return;
      }
      const data = await this.salarySlipService.upload({
        userId: req.body.userId,
        file: req.file,
        sender: this.actor(req),
        payDate: new Date(req.body.payDate),
        periodLabel: req.body.periodLabel,
        notes: req.body.notes ?? "",
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /salary-slips/mine — the caller's own slips. */
  listMine = async (req, res, next) => {
    try {
      const parsed = this.parseQuery(req);
      const data = await this.salarySlipService.listMine({
        userId: req.auth.userId,
        page: parsed.page ?? 1,
        pageSize: parsed.pageSize ?? 20,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /salary-slips — SUPERADMIN full list (`salary:manage`). */
  listAll = async (req, res, next) => {
    try {
      const parsed = this.parseQuery(req);
      const data = await this.salarySlipService.listAll({
        page: parsed.page ?? 1,
        pageSize: parsed.pageSize ?? 20,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /salary-slips/:id/download — binary blob. */
  download = async (req, res, next) => {
    try {
      const { buffer, record } = await this.salarySlipService.download({
        slipId: req.params.id,
        actor: this.actor(req),
      });
      res.setHeader("Content-Type", record.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${record.fileName.replace(/["\\]/g, "")}"`
      );
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  parseQuery(req) {
    const parsed = salarySlipListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
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

module.exports = { SalarySlipController };