/**
 * DashboardService — the aggregation surface (FR-025 / FR-026).
 *
 * Personal dashboard aggregates only the signed-in user's data (attendance
 * today, request counts, recent requests, quick actions). HR dashboard
 * aggregates company-wide statistics (workforce, attendance, pending counts,
 * recent approvals) and requires an HR-scope permission. All counts come from
 * the same sources as the module pages and reports so numbers are consistent.
 */

const {
  computeQuickActions,
  hasHrScope,
} = require("../domain/dashboard");
const { PermissionDeniedError } = require("../domain/errors");

class DashboardService {
  /**
   * @param {object} deps
   * @param {import('./attendance.service').AttendanceService} deps.attendanceService
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('../infrastructure/repositories/attendance.repository').AttendanceRepository} deps.attendanceRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   */
  constructor({
    attendanceService,
    requestService,
    pendingSummaryService,
    attendanceRepository,
    requestRepository,
    userRepository,
    orgRepository = null,
  }) {
    this.attendanceService = attendanceService;
    this.requestService = requestService;
    this.pendingSummaryService = pendingSummaryService;
    this.attendanceRepository = attendanceRepository;
    this.requestRepository = requestRepository;
    this.userRepository = userRepository;
    this.orgRepository = orgRepository;
  }

  /**
   * Personal dashboard summary (FR-025): attendance today + request counts +
   * recent requests + permission-gated quick actions.
   *
   * @param {string} userId
   * @param {{ permissions?: string[] }} options
   */
  async getPersonalSummary(userId, { permissions = [] } = {}) {
    const attendanceToday = await this.buildAttendanceToday(userId);
    const requestSummary = await this.requestRepository.countSummaryForUser(userId);
    const recent = await this.requestService.listMine(userId, {
      page: 1,
      pageSize: 5,
    });

    return {
      attendanceToday,
      requestSummary,
      recentRequests: recent.items.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        submittedAt: item.submittedAt,
        summary: item.summary,
      })),
      quickActions: computeQuickActions(permissions),
    };
  }

  /**
   * HR dashboard summary (FR-026): workforce, attendance, pending counts, and
   * recent approvals. Requires an HR-scope permission.
   *
   * @param {{ permissions?: string[], filters?: { from?: string, to?: string } }} options
   */
  async getHrSummary({ permissions = [], filters = {} } = {}) {
    if (!hasHrScope(permissions)) {
      throw new PermissionDeniedError("attendance:view_all");
    }

    const workDay = this.attendanceService.workDayFor();

    const [totalActiveEmployees, byDepartment, clockedInToday, exceptions, recentDecisions] =
      await Promise.all([
        this.userRepository.countActiveUsers(),
        this.userRepository.countActiveByDepartment(),
        this.attendanceRepository.countOpenShiftsByDate(workDay),
        this.attendanceRepository.countExceptionsInRange({
          from: filters.from,
          to: filters.to,
        }),
        this.requestRepository.findRecentDecisions({ limit: 5 }),
      ]);

    const [attendanceTodayUsers, activeUsers] = await Promise.all([
      this.attendanceRepository.distinctUserIdsOnDate(workDay),
      this.userRepository.listActiveUsers(),
    ]);
    const activeIds = activeUsers.map((u) => String(u._id ?? u.id));
    const notStarted = Math.max(0, totalActiveEmployees - attendanceTodayUsers.length);

    const pendingSummary = await this.pendingSummaryService.getPendingSummary(activeIds);
    const pendingTotal =
      pendingSummary.leave + pendingSummary.overtime + pendingSummary.trip;

    return {
      workforce: { totalActiveEmployees, byDepartment: await this.enrichDepartmentNames(byDepartment) },
      attendanceSummary: { clockedInToday, notStarted, exceptions },
      pendingRequests: {
        leave: pendingSummary.leave,
        overtime: pendingSummary.overtime,
        trip: pendingSummary.trip,
        total: pendingTotal,
      },
      recentApprovals: await this.enrichDecisions(recentDecisions),
    };
  }

  /**
   * Resolves human-readable department names for the workforce breakdown.
   * Rows without a configured department render as "Tanpa departemen".
   */
  async enrichDepartmentNames(rows) {
    if (!this.orgRepository || rows.length === 0) return rows;
    const departments = await this.orgRepository.listDepartments();
    const nameById = new Map(
      departments.map((d) => [String(d.id ?? d._id), d.name])
    );
    return rows.map((row) => ({
      departmentId: row.departmentId,
      name: row.departmentId ? (nameById.get(String(row.departmentId)) ?? null) : null,
      count: row.count,
    }));
  }

  /** Today's attendance state for a user (CLOCKED_IN / CLOCKED_OUT / NOT_STARTED). */
  async buildAttendanceToday(userId) {
    const today = await this.attendanceService.getToday(userId);
    if (!today) {
      return { status: "NOT_STARTED", clockInAt: null, clockOutAt: null };
    }
    return {
      status: today.clockOutAt ? "CLOCKED_OUT" : "CLOCKED_IN",
      clockInAt: today.clockInAt,
      clockOutAt: today.clockOutAt,
    };
  }

  /** Enriches recently decided requests with the requester's name. */
  async enrichDecisions(requests) {
    return Promise.all(
      requests.map(async (request) => {
        const requester = request.requesterId
          ? await this.userRepository.findById(request.requesterId)
          : null;
        return {
          id: String(request.id ?? request._id),
          type: request.type,
          requesterName: requester?.name ?? request.requesterId?.toString?.() ?? request.requesterId,
          status: request.status,
          decidedAt: request.decidedAt ?? null,
        };
      })
    );
  }
}

/** Compact human-readable summary for a request (dashboard list). */

module.exports = { DashboardService };
