/**
 * ReportService tests (FR-018 / FR-019): preview with filters, format-specific
 * export permissions, REPORT.VIEWED / REPORT.EXPORTED recording, and provider
 * availability.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const {
  ReportProviderRegistry,
  registerReportProviders,
  reportLocation,
} = require("../../src/infrastructure/report-providers");
const { ReportService } = require("../../src/application/report.service");
const { coordinateKey } = require("../../src/infrastructure/geocoding/reverse-geocoder");
const { PermissionDeniedError, NotFoundError, ReportUnavailableError } = require("../../src/domain/errors");

function makeService(registerAll = true, { reverseGeocoder = null, geocoding = {} } = {}) {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const registry = new ReportProviderRegistry();
  if (registerAll) {
    registerReportProviders({
      registry,
      attendanceRepository: fakes.attendanceRepository,
      requestRepository: fakes.requestRepository,
      userRepository: fakes.userRepository,
    });
  } else {
    // Register only the attendance provider so leave is "unavailable".
    const { AttendanceReportProvider } = require("../../src/infrastructure/report-providers");
    registry.register(new AttendanceReportProvider({ attendanceRepository: fakes.attendanceRepository, userRepository: fakes.userRepository }));
  }
  const service = new ReportService({
    registry,
    userRepository: fakes.userRepository,
    auditService,
    reverseGeocoder,
    geocoding,
  });
  return { service, fakes, auditService };
}

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Jane Doe", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_other", username: "other", email: "other@corp.io", name: "Other Person", status: "ACTIVE" });
}

async function seedAttendance(
  fakes,
  {
    userId = "u_emp",
    date = "2026-08-06",
    clockInLocation = null,
    clockOutLocation = null,
  } = {}
) {
  const rec = await fakes.attendanceRepository.create({
    userId,
    date,
    clockInAt: new Date(`${date}T08:00:00Z`),
    source: "SELF",
    exceptionTypes: [],
    status: "NORMAL",
  });
  rec.clockInLocation = clockInLocation;
  rec.clockOutAt = new Date(`${date}T17:00:00Z`);
  rec.clockOutLocation = clockOutLocation;
  await fakes.attendanceRepository.save(rec);
  return rec;
}

async function seedLeave(fakes, { requesterId = "u_emp", leaveType = "ANNUAL", status = "PENDING" } = {}) {
  return fakes.requestRepository.create({
    type: "LEAVE",
    requesterId,
    payload: { leaveType, startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" },
    status,
  });
}

async function seedSakit(fakes, { requesterId = "u_emp", sicknessType = "lt_sick", status = "PENDING" } = {}) {
  return fakes.requestRepository.create({
    type: "SAKIT",
    requesterId,
    payload: {
      sicknessType,
      sicknessTypeName: "Demam Berdarah",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      reason: "Sakit demam",
    },
    status,
  });
}

const ACTOR = {
  actorId: "u_hr",
  actorUsername: "hradmin",
  actorRoleKeys: ["HR_ADMIN"],
  actorPermissions: ["reporting:view", "reporting:export_excel"],
};

test("listTypes returns the five report types with column metadata", () => {
  const { service } = makeService();
  const types = service.listTypes();
  assert.equal(types.length, 5);
  assert.ok(types.find((t) => t.key === "ATTENDANCE" && t.columns.includes("exceptionTypes")));
  assert.ok(types.find((t) => t.key === "LEAVE" && t.filterableBy.includes("type")));
  assert.ok(
    types.find(
      (t) => t.key === "SAKIT" && t.columns.includes("sicknessType") && t.columns.includes("approvedBy")
    ),
    "SAKIT type present with sicknessType + approval columns"
  );
  assert.ok(
    types.every((t) => !t.filterableBy.includes("departmentId")),
    "departmentId filter removed from every type"
  );
});

test("reportLocation rejects schema-default null coordinates", () => {
  assert.equal(reportLocation({ latitude: null, longitude: null }), null);
  assert.deepEqual(reportLocation({ latitude: -6.2, longitude: 106.8 }), {
    latitude: -6.2,
    longitude: 106.8,
  });
});

test("preview projects rows and records REPORT.VIEWED activity", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes);

  const result = await service.preview("ATTENDANCE", { page: 1, pageSize: 20 }, ACTOR);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].employee, "Jane Doe");
  assert.ok(result.items[0].clockOutAt);
  assert.equal(result.items[0].clockInLocation, null);
  assert.equal(result.items[0].clockOutLocation, null);

  assert.ok(
    fakes.activityRepository.entries.some((e) => e.action === "REPORT.VIEWED")
  );
  assert.equal(
    fakes.auditRepository.entries.some((e) => e.action === "REPORT.VIEWED"),
    false,
    "preview is activity-only"
  );
});

test("attendance report falls back to formatted coordinates when geocoding is unavailable", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes, {
    clockInLocation: { latitude: -6.208763, longitude: 106.845599 },
    clockOutLocation: { latitude: -6.209, longitude: 106.846 },
  });

  const result = await service.preview("ATTENDANCE", { page: 1, pageSize: 20 }, ACTOR);
  assert.equal(result.items[0].clockInLocation, "-6.208763, 106.845599");
  assert.equal(result.items[0].clockOutLocation, "-6.209000, 106.846000");
});

test("attendance report uses cached reverse-geocoded addresses", async () => {
  const calls = [];
  const reverseGeocoder = {
    async resolveMany(points, options) {
      calls.push({ points, options });
      return new Map([
        [coordinateKey(-6.208763, 106.845599), "Jalan Sudirman 1, Jakarta, Indonesia"],
      ]);
    },
  };
  const { service, fakes } = makeService(true, {
    reverseGeocoder,
    geocoding: { previewDeadlineMs: 4000 },
  });
  seedUsers(fakes);
  await seedAttendance(fakes, {
    clockInLocation: { latitude: -6.208763, longitude: 106.845599 },
  });

  const result = await service.preview("ATTENDANCE", { page: 1, pageSize: 20 }, ACTOR);
  assert.equal(result.items[0].clockInLocation, "Jalan Sudirman 1, Jakarta, Indonesia");
  assert.equal(result.items[0].clockOutLocation, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].points.length, 1);
  assert.equal(calls[0].options.deadlineMs, 4000);
});

test("attendance Excel export contains resolved location values and headers", async () => {
  const reverseGeocoder = {
    async resolveMany() {
      return new Map([
        [coordinateKey(-6.208763, 106.845599), "Jalan Sudirman 1, Jakarta, Indonesia"],
      ]);
    },
  };
  const { service, fakes } = makeService(true, {
    reverseGeocoder,
    geocoding: { exportDeadlineMs: 4000 },
  });
  seedUsers(fakes);
  await seedAttendance(fakes, {
    clockInLocation: { latitude: -6.208763, longitude: 106.845599 },
  });

  const result = await service.exportReport("ATTENDANCE", {}, "excel", ACTOR);
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.content);
  const sheet = workbook.getWorksheet("Absensi");

  assert.equal(sheet.getCell("D2").value, "Lokasi absen masuk");
  assert.equal(sheet.getCell("F2").value, "Lokasi absen keluar");
  assert.equal(sheet.getCell("D3").value, "Jalan Sudirman 1, Jakarta, Indonesia");
  assert.equal(sheet.getCell("F3").value, "");
});

test("attendance preview geocodes only the current page", async () => {
  const calls = [];
  const reverseGeocoder = {
    async resolveMany(points) {
      calls.push(points);
      return new Map();
    },
  };
  const { service, fakes } = makeService(true, { reverseGeocoder });
  seedUsers(fakes);
  await seedAttendance(fakes, {
    date: "2026-08-06",
    clockInLocation: { latitude: -6.2, longitude: 106.8 },
  });
  await seedAttendance(fakes, {
    date: "2026-08-07",
    clockInLocation: { latitude: -6.3, longitude: 106.9 },
  });

  const result = await service.preview("ATTENDANCE", { page: 1, pageSize: 1 }, ACTOR);
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(result.items[0].clockInLocation, "-6.300000, 106.900000");
});

test("preview applies request filters (status + leave type)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedLeave(fakes, { status: "PENDING", leaveType: "ANNUAL" });
  await seedLeave(fakes, { status: "APPROVED", leaveType: "SICK" });

  const pending = await service.preview("LEAVE", { status: "PENDING", page: 1, pageSize: 20 }, ACTOR);
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].leaveType, "ANNUAL");

  const sick = await service.preview("LEAVE", { type: "SICK", page: 1, pageSize: 20 }, ACTOR);
  assert.equal(sick.total, 1);
  assert.equal(sick.items[0].status, "APPROVED");
});

test("preview rejects an unknown report type", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.preview("PAYROLL", {}, ACTOR),
    (err) => err instanceof NotFoundError && err.code === "REPORT_TYPE_NOT_FOUND"
  );
});

test("preview reports 422 when a provider is unavailable", async () => {
  const { service } = makeService(false); // leave provider not registered
  await assert.rejects(
    service.preview("LEAVE", {}, ACTOR),
    (err) => err instanceof ReportUnavailableError && err.code === "REPORT_UNAVAILABLE"
  );
});

test("preview resolves leave/sickness type names, never raw ids (FR-001/FR-002)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  // leaveTypeName snapshot fallback (no leaveTypeRepository wired in fakes).
  await seedLeave(fakes, { status: "APPROVED" });
  await seedSakit(fakes, { status: "APPROVED" });

  const leave = await service.preview("LEAVE", { page: 1, pageSize: 20 }, ACTOR);
  assert.equal(leave.total, 1);
  assert.equal(leave.items[0].leaveType, "ANNUAL", "raw key fallback when no snapshot/repo");

  const sakit = await service.preview("SAKIT", { page: 1, pageSize: 20 }, ACTOR);
  assert.equal(sakit.total, 1);
  assert.equal(sakit.items[0].sicknessType, "Demam Berdarah", "snapshot name wins");
  assert.ok(sakit.items[0].approvedBy === null || sakit.items[0].approvedBy === undefined);
});

test("resolveUserIds resolves employeeSearch to matching user ids (FR-003)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes); // Jane Doe / emp and Other Person / other
  const ids = await service.resolveUserIds({ employeeSearch: "jane" });
  assert.deepEqual(ids, ["u_emp"]);

  const noMatch = await service.resolveUserIds({ employeeSearch: "nobody-here" });
  assert.deepEqual(noMatch, []);

  const legacyId = await service.resolveUserIds({ employeeId: "u_other" });
  assert.deepEqual(legacyId, ["u_other"]);
});

test("export excel produces a real .xlsx workbook and records REPORT.EXPORTED (audit + activity)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes);

  const result = await service.exportReport("ATTENDANCE", {}, "excel", ACTOR);
  assert.equal(
    result.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.ok(Buffer.isBuffer(result.content), "content is a Buffer from exceljs");
  assert.equal(result.filename, "attendance-report.xlsx");
  assert.ok(result.content.subarray(0, 2).toString("latin1") === "PK", "xlsx zip signature");
  assert.equal(result.rowCount, 1);

  const audit = fakes.auditRepository.entries.find((e) => e.action === "REPORT.EXPORTED");
  assert.ok(audit, "REPORT.EXPORTED audit event");
  assert.equal(audit.metadata.format, "excel");
  assert.equal(audit.metadata.rowCount, 1);
  assert.ok(
    fakes.activityRepository.entries.some((e) => e.action === "REPORT.EXPORTED"),
    "also on the activity surface"
  );
});

test("export requires the export_excel permission", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes);
  const viewOnly = { ...ACTOR, actorPermissions: ["reporting:view"] };
  await assert.rejects(
    service.exportReport("ATTENDANCE", {}, "excel", viewOnly),
    PermissionDeniedError
  );

  const excelOnly = { ...ACTOR, actorPermissions: ["reporting:view", "reporting:export_excel"] };
  const excel = await service.exportReport("ATTENDANCE", {}, "excel", excelOnly);
  assert.equal(excel.rowCount, 1);
});

test("exportAllModules combines every module into one .xlsx with a type column (FR-063)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes);

  const result = await service.exportAllModules({}, ACTOR);
  assert.equal(
    result.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.ok(Buffer.isBuffer(result.content), "content is a Buffer from exceljs");
  assert.equal(result.filename, "all-modules-report.xlsx");
  assert.ok(result.content.subarray(0, 2).toString("latin1") === "PK", "xlsx zip signature");
  assert.ok(result.rowCount >= 1);

  const audit = fakes.auditRepository.entries.find((e) => e.action === "REPORT.EXPORTED");
  assert.ok(audit, "REPORT.EXPORTED audit event");
  assert.equal(audit.metadata.reportType, "*");
  assert.equal(audit.metadata.format, "excel");
});

test("exportAllModules requires the export_excel permission", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const viewOnly = { ...ACTOR, actorPermissions: ["reporting:view"] };
  await assert.rejects(
    service.exportAllModules({}, viewOnly),
    PermissionDeniedError
  );
});

test("team-scoped preview returns only the manager's direct reports (FR-038)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  // u_other reports to u_emp (the acting manager).
  fakes.userRepository.users.get("u_other").managerId = "u_emp";
  await seedAttendance(fakes, { userId: "u_emp" });
  await seedAttendance(fakes, { userId: "u_other" });

  const manager = {
    actorId: "u_emp",
    actorRoleKeys: ["MANAGER"],
    actorPermissions: ["reporting:view", "team:view_team"],
  };
  const team = await service.preview("ATTENDANCE", { page: 1, pageSize: 20 }, manager, "team");
  assert.equal(team.total, 1, "only the direct report is included");
  assert.equal(team.items[0].employee, "Other Person");

  // A manager without team:view_team cannot request team scope.
  const noTeam = { ...ACTOR, actorId: "u_emp", actorPermissions: ["reporting:view"] };
  await assert.rejects(
    service.preview("ATTENDANCE", {}, noTeam, "team"),
    (err) => err instanceof PermissionDeniedError && err.details.permissionKey === "team:view_team"
  );

  // Company-wide (default) still returns both rows for an HR actor.
  const company = await service.preview("ATTENDANCE", { page: 1, pageSize: 20 }, ACTOR, null);
  assert.equal(company.total, 2);
});
