/**
 * DashboardService tests (FR-025 / FR-026): personal summary scoping,
 * HR summary aggregates, HR-scope enforcement, and quick-action derivation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { RequestService } = require("../../src/application/request.service");
const { AttendanceService } = require("../../src/application/attendance.service");
const { LeaveService } = require("../../src/application/leave.service");
const { OvertimeService } = require("../../src/application/overtime.service");
const { TripService } = require("../../src/application/trip.service");
const { DashboardService } = require("../../src/application/dashboard.service");
const { PermissionDeniedError } = require("../../src/domain/errors");

function makeService() {
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
  const pendingSummaryService = new PendingSummaryService();
  const eventBus = new EventBus();
  const requestService = new RequestService({
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    eventBus,
  });
  const attendanceService = new AttendanceService({
    attendanceRepository: fakes.attendanceRepository,
    userRepository: fakes.userRepository,
    correctionModel: fakes.attendanceCorrectionModel,
    pendingSummaryService,
    auditService,
    config: { security: { companyTimezoneOffsetMs: 0 } },
  });
  // Register the request module pending providers (as server.js does).
  new LeaveService({ requestService, pendingSummaryService });
  new OvertimeService({ requestService, pendingSummaryService });
  new TripService({ requestService, pendingSummaryService });

  const dashboardService = new DashboardService({
    attendanceService,
    requestService,
    pendingSummaryService,
    attendanceRepository: fakes.attendanceRepository,
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
  });

  return { dashboardService, fakes, attendanceService };
}

const today = new Date().toISOString().slice(0, 10);

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Jane Doe", status: "ACTIVE", departmentId: "d_eng" });
  fakes.userRepository.seed({ id: "u_other", username: "other", email: "other@corp.io", name: "Other Person", status: "ACTIVE", departmentId: "d_eng" });
}

async function seedAttendance(fakes, attendanceService, { userId = "u_emp", open = true } = {}) {
  const rec = await fakes.attendanceRepository.create({
    userId,
    date: today,
    clockInAt: new Date(),
    source: "SELF",
    exceptionTypes: [],
    status: "NORMAL",
  });
  if (!open) {
    rec.clockOutAt = new Date(Date.now() + 60_000);
    await fakes.attendanceRepository.save(rec);
  }
  void attendanceService;
  return rec;
}

function seedRequest(fakes, { requesterId = "u_emp", type = "LEAVE", status = "PENDING", decidedAt = null } = {}) {
  return fakes.requestRepository.create({
    type,
    requesterId,
    payload:
      type === "LEAVE"
        ? { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" }
        : type === "OVERTIME"
          ? { date: "2026-09-10", startTime: "18:00", endTime: "21:00", reason: "x" }
          : { destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-02", purpose: "x" },
    status,
  }).then((request) => {
    if (decidedAt) request.decidedAt = decidedAt;
    return request;
  });
}

test("personal summary aggregates only the signed-in user's data (E1)", async () => {
  const { dashboardService, fakes, attendanceService } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes, attendanceService, { userId: "u_emp", open: true });
  await seedAttendance(fakes, attendanceService, { userId: "u_other", open: false });
  await seedRequest(fakes, { requesterId: "u_emp", status: "PENDING" });
  await seedRequest(fakes, { requesterId: "u_emp", status: "APPROVED" });
  await seedRequest(fakes, { requesterId: "u_other", status: "PENDING" });

  const summary = await dashboardService.getPersonalSummary("u_emp", {
    permissions: ["dashboard:view", "attendance:clock_in", "leave:submit"],
  });

  assert.equal(summary.attendanceToday.status, "CLOCKED_IN");
  assert.equal(summary.requestSummary.pending, 1);
  assert.equal(summary.requestSummary.approved, 1);
  assert.equal(summary.requestSummary.byType.leave, 2, "only own requests counted");
  assert.equal(summary.recentRequests.length, 2);
  assert.ok(
    summary.recentRequests.every((r) => r.summary && r.type && r.status),
    "recent requests carry a summary"
  );
  assert.deepEqual(
    summary.quickActions,
    ["attendance:clock_in", "leave:submit"],
    "quick actions derive from permissions (E3)"
  );
});

test("personal summary shows CLOCKED_OUT and NOT_STARTED states", async () => {
  const { dashboardService, fakes, attendanceService } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes, attendanceService, { userId: "u_emp", open: false });

  const closed = await dashboardService.getPersonalSummary("u_emp", { permissions: [] });
  assert.equal(closed.attendanceToday.status, "CLOCKED_OUT");

  const notStarted = await dashboardService.getPersonalSummary("u_other", { permissions: [] });
  assert.equal(notStarted.attendanceToday.status, "NOT_STARTED");
});

test("HR summary requires HR scope (E2/F8)", async () => {
  const { dashboardService } = makeService();
  await assert.rejects(
    dashboardService.getHrSummary({ permissions: ["dashboard:view"] }),
    PermissionDeniedError
  );
});

test("HR summary aggregates workforce, attendance, pending, and approvals (E2)", async () => {
  const { dashboardService, fakes, attendanceService } = makeService();
  seedUsers(fakes);
  await seedAttendance(fakes, attendanceService, { userId: "u_emp", open: true });
  await seedRequest(fakes, { requesterId: "u_emp", status: "PENDING", type: "LEAVE" });
  await seedRequest(fakes, { requesterId: "u_other", status: "PENDING", type: "OVERTIME" });
  await seedRequest(fakes, { requesterId: "u_emp", status: "APPROVED", type: "TRIP", decidedAt: new Date() });

  const hr = await dashboardService.getHrSummary({
    permissions: ["dashboard:view", "attendance:view_all", "users:view", "leave:review"],
  });

  assert.equal(hr.workforce.totalActiveEmployees, 2);
  assert.ok(Array.isArray(hr.workforce.byDepartment));
  assert.equal(hr.attendanceSummary.clockedInToday, 1);
  assert.equal(hr.attendanceSummary.notStarted, 1, "one active user has no attendance today");
  assert.equal(hr.pendingRequests.leave, 1);
  assert.equal(hr.pendingRequests.overtime, 1);
  assert.equal(hr.pendingRequests.total, 2);
  assert.equal(hr.recentApprovals.length, 1);
  assert.equal(hr.recentApprovals[0].requesterName, "Jane Doe");
});

test("reporting:view alone also grants HR scope", async () => {
  const { dashboardService } = makeService();
  const hr = await dashboardService.getHrSummary({
    permissions: ["dashboard:view", "reporting:view"],
  });
  assert.equal(typeof hr.workforce.totalActiveEmployees, "number");
});
