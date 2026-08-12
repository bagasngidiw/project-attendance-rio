/**
 * Reporting domain model (FR-018 / FR-019).
 *
 * A report-type registry defines the ordered column set and applicable
 * filters per report; providers supply raw rows; the domain projects each row
 * to the type's columns and validates the shared filter model. Screen preview
 * and export share the same filter shape so results are identical.
 */

const { ValidationError } = require("./errors");

/** Report-type registry (design §3.1). Provider keys map to data providers. */
const REPORT_TYPES = Object.freeze({
  ATTENDANCE: Object.freeze({
    key: "ATTENDANCE",
    label: "Absensi",
    columns: ["employee", "date", "clockInAt", "clockOutAt", "status", "exceptionTypes"],
    filterableBy: ["employeeId", "from", "to", "status"],
    provider: "attendance",
  }),
  LEAVE: Object.freeze({
    key: "LEAVE",
    label: "Cuti",
    columns: ["employee", "leaveType", "startDate", "endDate", "status", "reason", "approvalTarget", "assignedApprover", "approvedBy", "rejectedBy", "rejectionReason"],
    filterableBy: ["employeeId", "from", "to", "status", "type"],
    provider: "leave",
  }),
  OVERTIME: Object.freeze({
    key: "OVERTIME",
    label: "Lembur",
    columns: ["employee", "date", "startTime", "endTime", "durationHours", "status", "reason", "approvalTarget", "assignedApprover", "approvedBy", "rejectedBy", "rejectionReason"],
    filterableBy: ["employeeId", "from", "to", "status"],
    provider: "overtime",
  }),
  TRIP: Object.freeze({
    key: "TRIP",
    label: "Perjalanan Dinas",
    columns: ["employee", "destination", "startDate", "endDate", "status", "purpose", "approvalTarget", "assignedApprover", "approvedBy", "rejectedBy", "rejectionReason"],
    filterableBy: ["employeeId", "from", "to", "status"],
    provider: "trip",
  }),
  SAKIT: Object.freeze({
    key: "SAKIT",
    label: "Sakit",
    columns: ["employee", "sicknessType", "startDate", "endDate", "status", "reason", "approvalTarget", "assignedApprover", "approvedBy", "rejectedBy", "rejectionReason"],
    filterableBy: ["employeeId", "from", "to", "status"],
    provider: "sakit",
  }),
});

/** Report keys in registry order (for the console). */
const REPORT_TYPE_KEYS = Object.freeze(Object.keys(REPORT_TYPES));

/**
 * Indonesian column labels for export headers — a manual mirror of
 * `frontend/src/lib/labels.ts` (keep in sync, same as contracts/permissions.ts).
 */
const REPORT_COLUMN_LABELS = Object.freeze({
  employee: "Karyawan",
  date: "Tanggal",
  clockInAt: "Absen masuk",
  clockOutAt: "Absen keluar",
  status: "Status",
  exceptionTypes: "Pengecualian",
  leaveType: "Jenis cuti",
  sicknessType: "Tipe sakit",
  startDate: "Tanggal mulai",
  endDate: "Tanggal selesai",
  reason: "Alasan",
  startTime: "Waktu mulai",
  endTime: "Waktu selesai",
  durationHours: "Durasi (jam)",
  destination: "Tujuan",
  purpose: "Tujuan kegiatan",
  approvalTarget: "Target Persetujuan",
  assignedApprover: "Penyetuju Ditugaskan",
  approvedBy: "Disetujui Oleh",
  rejectedBy: "Ditolak Oleh",
  rejectionReason: "Alasan Penolakan",
});

/**
 * Resolves a report type by key; throws NotFoundError(REPORT_TYPE_NOT_FOUND)
 * for unknown keys.
 */
function assertReportType(typeKey) {
  const type = REPORT_TYPES[typeKey];
  if (!type) {
    const { NotFoundError } = require("./errors");
    throw new NotFoundError(`Unknown report type "${typeKey}".`, "REPORT_TYPE_NOT_FOUND");
  }
  return type;
}

/**
 * Validates the shared report filter model (FR-019): overlapping date range
 * and allowed status values per type.
 *
 * @param {object} type report type definition
 * @param {object} filters raw query filters
 * @returns {object} validated filters
 */
function validateReportFilters(type, filters = {}) {
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new ValidationError("from must be on or before to.", { field: "to" });
  }

  if (type.key === "ATTENDANCE" && filters.status) {
    if (!["NORMAL", "EXCEPTION"].includes(filters.status)) {
      throw new ValidationError("status must be NORMAL or EXCEPTION.", {
        field: "status",
      });
    }
  }

  if (type.key === "LEAVE" && filters.type) {
    if (!["SICK", "PERSONAL", "ANNUAL"].includes(filters.type)) {
      throw new ValidationError("type must be SICK, PERSONAL, or ANNUAL.", {
        field: "type",
      });
    }
  }

  const allowed = new Set([
    "from",
    "to",
    "employeeSearch",
    "employeeId",
    "status",
    "type",
    "page",
    "pageSize",
  ]);
  for (const key of Object.keys(filters)) {
    if (!allowed.has(key)) delete filters[key];
  }

  return filters;
}

/**
 * Projects a raw provider row to the type's ordered column set.
 *
 * @param {string} typeKey
 * @param {object} row provider row
 * @returns {object} projected { column: value }
 */
function projectRow(typeKey, row) {
  const type = assertReportType(typeKey);
  const projected = {};
  for (const column of type.columns) {
    projected[column] = row[column] ?? null;
  }
  return projected;
}

module.exports = {
  REPORT_TYPES,
  REPORT_TYPE_KEYS,
  REPORT_COLUMN_LABELS,
  assertReportType,
  validateReportFilters,
  projectRow,
};
