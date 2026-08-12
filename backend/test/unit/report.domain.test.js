/**
 * Reporting domain tests (FR-018 / FR-019): type registry, filter validation,
 * and column projection.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  REPORT_TYPES,
  REPORT_TYPE_KEYS,
  assertReportType,
  validateReportFilters,
  projectRow,
} = require("../../src/domain/report");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

test("the registry exposes the five report types with ordered columns", () => {
  assert.deepEqual(REPORT_TYPE_KEYS, [
    "ATTENDANCE",
    "LEAVE",
    "OVERTIME",
    "TRIP",
    "SAKIT",
  ]);
  assert.equal(REPORT_TYPES.ATTENDANCE.label, "Absensi");
  assert.deepEqual(REPORT_TYPES.ATTENDANCE.columns, [
    "employee",
    "date",
    "clockInAt",
    "clockOutAt",
    "status",
    "exceptionTypes",
  ]);
  assert.deepEqual(REPORT_TYPES.LEAVE.columns, [
    "employee",
    "leaveType",
    "startDate",
    "endDate",
    "status",
    "reason",
    "approvalTarget",
    "assignedApprover",
    "approvedBy",
    "rejectedBy",
    "rejectionReason",
  ]);
  assert.ok(REPORT_TYPES.OVERTIME.columns.includes("durationHours"));
  assert.ok(REPORT_TYPES.TRIP.columns.includes("destination"));
  assert.ok(REPORT_TYPES.TRIP.columns.includes("assignedApprover"), "FR-009 approval columns");
  assert.equal(REPORT_TYPES.SAKIT.label, "Sakit");
  assert.deepEqual(REPORT_TYPES.SAKIT.columns, [
    "employee",
    "sicknessType",
    "startDate",
    "endDate",
    "status",
    "reason",
    "approvalTarget",
    "assignedApprover",
    "approvedBy",
    "rejectedBy",
    "rejectionReason",
  ]);
  assert.ok(
    Object.values(REPORT_TYPES).every((t) => !t.filterableBy.includes("departmentId")),
    "departmentId filter removed (FR-003)"
  );
});

test("assertReportType resolves known types and rejects unknown ones (F3)", () => {
  assert.equal(assertReportType("LEAVE").provider, "leave");
  assert.throws(
    () => assertReportType("PAYROLL"),
    (err) => err instanceof NotFoundError && err.code === "REPORT_TYPE_NOT_FOUND"
  );
});

test("validateReportFilters rejects an inverted date range (F1)", () => {
  const filters = { from: "2026-08-10", to: "2026-08-01" };
  assert.throws(
    () => validateReportFilters(REPORT_TYPES.ATTENDANCE, filters),
    (err) => err instanceof ValidationError && err.details.field === "to"
  );
});

test("validateReportFilters rejects invalid attendance status and leave type (F1)", () => {
  assert.throws(
    () => validateReportFilters(REPORT_TYPES.ATTENDANCE, { status: "BAD" }),
    (err) => err instanceof ValidationError && err.details.field === "status"
  );
  assert.throws(
    () => validateReportFilters(REPORT_TYPES.LEAVE, { type: "UNPAID" }),
    (err) => err instanceof ValidationError && err.details.field === "type"
  );
  assert.doesNotThrow(() =>
    validateReportFilters(REPORT_TYPES.ATTENDANCE, { status: "EXCEPTION" })
  );
  assert.doesNotThrow(() =>
    validateReportFilters(REPORT_TYPES.LEAVE, { type: "ANNUAL" })
  );
});

test("projectRow emits only the type's columns in order (F3)", () => {
  const projected = projectRow("TRIP", {
    employee: "Jane",
    destination: "Singapore",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    status: "APPROVED",
    purpose: "Client visit",
    extra: "ignored",
  });
  assert.deepEqual(projected, {
    employee: "Jane",
    destination: "Singapore",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    status: "APPROVED",
    purpose: "Client visit",
    approvalTarget: null,
    assignedApprover: null,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
  });
  assert.ok(!("extra" in projected), "unknown columns are dropped");
});
