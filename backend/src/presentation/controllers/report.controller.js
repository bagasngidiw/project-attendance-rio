/**
 * ReportController — report types, preview, and export (FR-018 / FR-019).
 * Export sets the correct content type/disposition and streams the file.
 */

const { reportFiltersSchema, exportFormatSchema } = require("../dto/report.dto");
const { ValidationError } = require("../../domain/errors");

class ReportController {
  constructor({ reportService }) {
    this.reportService = reportService;
  }

  /** GET /reports/types */
  listTypes = async (req, res, next) => {
    try {
      res.status(200).json({ data: { items: this.reportService.listTypes() } });
    } catch (err) {
      next(err);
    }
  };

  /** GET /reports/:type — on-screen preview with filters (optional scope=team). */
  preview = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.reportService.preview(
        this.normalizeType(req.params.type),
        filters,
        this.actor(req),
        req.query.scope ?? null
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /reports/:type/export?format=excel|pdf (optional scope=team) */
  exportReport = async (req, res, next) => {
    try {
      const format = this.parseFormat(req.query.format);
      const filters = this.parseFilters(req.query);
      const { content, contentType, filename } =
        await this.reportService.exportReport(
          this.normalizeType(req.params.type),
          filters,
          format,
          this.actor(req),
          req.query.scope ?? null
        );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(content);
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /reports/export — FR-063 all-modules Excel export. Filters are read
   * from the query string for parity with per-type exports.
   */
  exportAll = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const { content, contentType, filename } =
        await this.reportService.exportAllModules(
          filters,
          this.actor(req),
          req.query.scope ?? null
        );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(content);
    } catch (err) {
      next(err);
    }
  };

  /** Report types are matched case-insensitively in the URL. */
  normalizeType(value) {
    return String(value ?? "").toUpperCase();
  }

  parseFilters(query) {
    const parsed = reportFiltersSchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError("Invalid report filters.", {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  parseFormat(value) {
    const parsed = exportFormatSchema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError("format must be excel.", {
        field: "format",
      });
    }
    return parsed.data;
  }

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorUsername: req.auth.username,
      actorRoleKeys: req.auth.roles,
      actorPermissions: req.auth.permissions,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { ReportController };
