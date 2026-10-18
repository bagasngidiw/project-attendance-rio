/**
 * ReportService — the reporting surface (FR-018 / FR-019).
 *
 * Lists report types, previews filtered results on-screen, and exports the
 * same filtered data as Excel. Export is an action permission
 * checked per request; every export records REPORT.EXPORTED (audit +
 * activity) and previews record REPORT.VIEWED (activity). Data scope is
 * resolved by the caller (company-wide for HR/SUPER_ADMIN).
 */

const {
  REPORT_TYPES,
  REPORT_TYPE_KEYS,
  REPORT_COLUMN_LABELS,
  assertReportType,
  validateReportFilters,
  projectRow,
} = require("../domain/report");
const { hasPermission } = require("../domain/permissions");
const {
  PermissionDeniedError,
  ReportUnavailableError,
} = require("../domain/errors");
const { renderExcel } = require("../infrastructure/exporters/excel.exporter");
const {
  formatCoordinates,
  normalizeLocation,
} = require("../infrastructure/geocoding/reverse-geocoder");

class ReportService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/report-providers').ReportProviderRegistry} deps.registry
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    registry,
    userRepository,
    auditService,
    reverseGeocoder = null,
    geocoding = {},
  }) {
    this.registry = registry;
    this.userRepository = userRepository;
    this.auditService = auditService;
    this.reverseGeocoder = reverseGeocoder;
    this.geocoding = geocoding;
  }

  /** Available report types + column/filter metadata (FR-018 §4.1). */
  listTypes() {
    return REPORT_TYPE_KEYS.map((key) => ({
      key: REPORT_TYPES[key].key,
      label: REPORT_TYPES[key].label,
      columns: REPORT_TYPES[key].columns,
      filterableBy: REPORT_TYPES[key].filterableBy,
    }));
  }

  /**
   * Resolves employee/team filters to a user-id set (null = all).
   * FR-003: `employeeSearch` is a free-text name/username search resolved
   * server-side via the user text index; `employeeId` remains for API compat.
   * `scope = "team"` limits rows to the caller's ACTIVE direct reports (FR-038).
   *
   * @param {object} filters
   * @param {string|null} scope
   * @param {string|null} callerId
   */
  async resolveUserIds(filters, scope = null, callerId = null) {
    if (filters.employeeSearch) {
      const { items } = await this.userRepository.list({
        search: filters.employeeSearch,
        page: 1,
        pageSize: 10000,
      });
      return items.map((u) => String(u._id ?? u.id));
    }
    if (filters.employeeId) return [filters.employeeId];
    if (scope === "team" && callerId) {
      const reports = await this.userRepository.findDirectReports(callerId);
      return reports.map((u) => String(u._id ?? u.id));
    }
    return null;
  }

  /** True when the caller may request a team-scoped report (FR-038). */
  canUseTeamScope(actor) {
    return (
      hasPermission(actor.actorPermissions ?? [], "team:view_team") ||
      hasPermission(actor.actorPermissions ?? [], "attendance:view_all")
    );
  }

  /**
   * On-screen results preview (FR-019). Records REPORT.VIEWED activity.
   *
   * @param {string} typeKey
   * @param {object} filters validated filters incl. page/pageSize
   * @param {object} actor
   * @param {string|null} scope optional "team" scope
   */
  async preview(typeKey, filters, actor = {}, scope = null) {
    const type = assertReportType(typeKey);
    validateReportFilters(type, filters);
    const provider = this.registry.get(type.provider);
    if (!provider) {
      throw new ReportUnavailableError(typeKey);
    }
    if (scope === "team" && !this.canUseTeamScope(actor)) {
      throw new PermissionDeniedError("team:view_team");
    }

    const userIds = await this.resolveUserIds(filters, scope, actor.actorId);
    const rows = await provider.query({ userIds, filters });
    const projected = rows.map((row) => projectRow(typeKey, row));

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const total = projected.length;
    const pageItems = projected.slice((page - 1) * pageSize, page * pageSize);
    const items = await this.enrichLocations(
      typeKey,
      pageItems,
      this.geocoding.previewDeadlineMs
    );

    await this.auditService.record({
      action: "REPORT.VIEWED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "REPORT", id: typeKey, summary: type.label },
      outcome: "SUCCESS",
      metadata: { reportType: typeKey, scope: scope ?? "company", filters: cleanFilters(filters) },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { items, total, page, pageSize };
  }

  /**
   * Exports the filtered report as a real Excel workbook (.xlsx via exceljs,
   * FR-005). PDF export was removed (FR-006). The export permission is
   * checked here (defense in depth behind the route gate) and REPORT.EXPORTED
   * is recorded with format, filters, and row count.
   *
   * @param {string} typeKey
   * @param {object} filters
   * @param {"excel"} format
   * @param {object} actor { actorId, actorUsername, actorPermissions, ... }
   * @param {string|null} scope optional "team" scope (FR-038)
   */
  async exportReport(typeKey, filters, format, actor = {}, scope = null) {
    const type = assertReportType(typeKey);
    validateReportFilters(type, filters);

    if (!hasPermission(actor.actorPermissions ?? [], "reporting:export_excel")) {
      throw new PermissionDeniedError("reporting:export_excel");
    }
    if (scope === "team" && !this.canUseTeamScope(actor)) {
      throw new PermissionDeniedError("team:view_team");
    }

    const provider = this.registry.get(type.provider);
    if (!provider) {
      throw new ReportUnavailableError(typeKey);
    }

    const userIds = await this.resolveUserIds(filters, scope, actor.actorId);
    const rows = await provider.query({ userIds, filters });
    const projected = rows.map((row) => projectRow(typeKey, row));
    const enriched = await this.enrichLocations(
      typeKey,
      projected,
      this.geocoding.exportDeadlineMs
    );

    const generatedAt = new Date().toISOString();
    const content = await renderExcel({
      type,
      rows: enriched,
      columnLabels: REPORT_COLUMN_LABELS,
      title: `Laporan ${type.label}`,
      generatedAt,
    });
    const contentType =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const filename = `${typeKey.toLowerCase()}-report.xlsx`;

    await this.auditService.record({
      action: "REPORT.EXPORTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "REPORT", id: filename, summary: type.label },
      outcome: "SUCCESS",
      metadata: {
        reportType: typeKey,
        format,
        scope: scope ?? "company",
        filters: cleanFilters(filters),
        rowCount: enriched.length,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { content, contentType, filename, rowCount: enriched.length };
  }

  /**
   * FR-063 U.4/U.9: exports ALL report modules combined into one Excel (.xlsx)
   * workbook — a leading `type` column distinguishes the source module. Filters
   * and scope are respected per module; the export is audited as REPORT.EXPORTED.
   *
   * @param {object} filters
   * @param {object} actor
   * @param {string|null} scope optional "team" scope
   */
  async exportAllModules(filters = {}, actor = {}, scope = null) {
    const permissionKey = "reporting:export_excel";
    if (!hasPermission(actor.actorPermissions ?? [], permissionKey)) {
      throw new PermissionDeniedError(permissionKey);
    }
    if (scope === "team" && !this.canUseTeamScope(actor)) {
      throw new PermissionDeniedError("team:view_team");
    }

    const userIds = await this.resolveUserIds(filters, scope, actor.actorId);
    const sections = [];

    for (const key of REPORT_TYPE_KEYS) {
      const type = REPORT_TYPES[key];
      const provider = this.registry.get(type.provider);
      if (!provider) continue;
      const rows = await provider.query({ userIds, filters });
      const projected = rows.map((row) => ({
        type: type.label,
        ...projectRow(key, row),
      }));
      const enriched = await this.enrichLocations(
        key,
        projected,
        this.geocoding.exportDeadlineMs
      );
      sections.push({ type, rows: enriched });
    }

    const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
    const combined = {
      columns: ["type", ...new Set(sections.flatMap((s) => s.type.columns))],
      label: "Semua Modul",
      rows: sections.flatMap((s) => s.rows),
    };

    const generatedAt = new Date().toISOString();
    const filename = "all-modules-report.xlsx";
    const content = await renderExcel({
      type: combined,
      rows: combined.rows,
      columnLabels: { type: "Modul", ...REPORT_COLUMN_LABELS },
      title: "Laporan Semua Modul",
      generatedAt,
    });

    await this.auditService.record({
      action: "REPORT.EXPORTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "REPORT", id: filename, summary: "Ekspor semua modul" },
      outcome: "SUCCESS",
      metadata: {
        reportType: "*",
        format: "excel",
        scope: scope ?? "company",
        filters: cleanFilters(filters),
        rowCount: totalRows,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      content,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
      rowCount: totalRows,
    };
  }

  /**
   * Resolves attendance coordinate objects to readable report values. The
   * provider deliberately passes only latitude/longitude; this method keeps
   * external geocoding out of the data provider and guarantees a coordinate
   * fallback whenever the provider or cache is unavailable.
   */
  async enrichLocations(typeKey, rows, deadlineMs) {
    if (typeKey !== "ATTENDANCE" || !Array.isArray(rows) || rows.length === 0) {
      return rows;
    }

    const fields = ["clockInLocation", "clockOutLocation"];
    const points = [];
    for (const row of rows) {
      for (const field of fields) {
        const point = normalizeLocation(row[field]);
        if (point) points.push(point);
      }
    }

    let addresses = new Map();
    if (this.reverseGeocoder?.resolveMany && points.length > 0) {
      try {
        addresses = await this.reverseGeocoder.resolveMany(points, {
          deadlineMs,
        });
      } catch {
        // A report must remain usable even when an injected geocoder fails.
        addresses = new Map();
      }
    }

    return rows.map((row) => {
      const enriched = { ...row };
      for (const field of fields) {
        const point = normalizeLocation(row[field]);
        if (!point) {
          enriched[field] = row[field] == null ? null : row[field];
          continue;
        }
        enriched[field] = addresses.get(point.key) || formatCoordinates(point);
      }
      return enriched;
    });
  }
}

/** Removes pagination from the filter snapshot recorded in events. */
function cleanFilters(filters) {
  const { page, pageSize, ...rest } = filters ?? {};
  void page;
  void pageSize;
  return rest;
}

module.exports = { ReportService };
