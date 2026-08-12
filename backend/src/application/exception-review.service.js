/**
 * ExceptionReviewService — Manager review of team attendance exceptions
 * (FR-053).
 *
 * A Manager resolves their ACTIVE direct reports, sees only exception records
 * that belong to those reports, and appends a review outcome. Scope is
 * enforced at the boundary: out-of-scope records answer 404 (no existence
 * leak), and an HR admin cannot use this surface — the route layer requires
 * `attendance:review_exceptions`. Managers never correct records here; a
 * review only flags an exception for HR or requests a correction.
 */

const { NotFoundError } = require("../domain/errors");

/** Cap for the underlying query; final pagination happens in the service. */
const TEAM_QUERY_CAP = 10000;

class ExceptionReviewService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/attendance.repository').AttendanceRepository} deps.attendanceRepository
   * @param {import('../infrastructure/repositories/exception-review.repository').ExceptionReviewRepository} deps.exceptionReviewRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    userRepository,
    attendanceRepository,
    exceptionReviewRepository,
    auditService,
  }) {
    this.userRepository = userRepository;
    this.attendanceRepository = attendanceRepository;
    this.exceptionReviewRepository = exceptionReviewRepository;
    this.auditService = auditService;
  }

  /**
   * Exception records for the manager's direct reports, enriched with owner
   * identity and prior review outcomes.
   *
   * @param {{ managerId: string, from?: string, to?: string, status?: string, exception?: string, page?: number, pageSize?: number }} filters
   */
  async listTeamExceptions({
    managerId,
    from,
    to,
    status,
    exception,
    page = 1,
    pageSize = 20,
  } = {}) {
    const reports = await this.userRepository.findDirectReports(managerId);
    const reportIds = reports.map((user) => String(user.id ?? user._id));
    if (reportIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const { items } = await this.attendanceRepository.queryOverview({
      userIds: reportIds,
      from,
      to,
      status,
      exception,
      page: 1,
      pageSize: TEAM_QUERY_CAP,
    });

    const userById = new Map(
      reports.map((user) => [String(user.id ?? user._id), user])
    );

    // Only records that actually carry exceptions are surfaced.
    const exceptions = items.filter(
      (record) => (record.exceptionTypes ?? []).length > 0
    );

    const enriched = await Promise.all(
      exceptions.map(async (record) => {
        const reviews = await this.exceptionReviewRepository.findByAttendanceId(
          record.id ?? record._id
        );
        return this.toDto(
          record,
          userById.get(String(record.userId)) ?? null,
          reviews
        );
      })
    );

    const start = (page - 1) * pageSize;
    return {
      items: enriched.slice(start, start + pageSize),
      total: enriched.length,
      page,
      pageSize,
    };
  }

  /**
   * Appends a manager review for a direct report's exception record.
   * Out-of-scope records, missing records, and records without exceptions all
   * answer 404 — the reviewer can never probe employee existence.
   *
   * @param {{ attendanceId: string, reviewerId: string, outcome: string, comment?: string }} input
   * @param {object} [actor]
   */
  async recordReview({ attendanceId, reviewerId, outcome, comment = "" }, actor = {}) {
    const record = await this.attendanceRepository.findById(attendanceId);
    if (!record || (record.exceptionTypes ?? []).length === 0) {
      throw new NotFoundError(
        "Attendance record not found.",
        "ATTENDANCE_NOT_FOUND"
      );
    }

    const member = await this.userRepository.findDirectReportById(
      reviewerId,
      record.userId
    );
    if (!member) {
      throw new NotFoundError(
        "Attendance record not found.",
        "ATTENDANCE_NOT_FOUND"
      );
    }

    const review = await this.exceptionReviewRepository.create({
      attendanceId,
      userId: String(record.userId),
      reviewerId,
      outcome,
      comment: comment ?? "",
    });

    await this.auditService.record({
      action: "ATTENDANCE.EXCEPTION_REVIEWED",
      actor: {
        userId: actor.actorId ?? reviewerId,
        roleKeys: actor.actorRoleKeys ?? [],
      },
      subject: {
        type: "ATTENDANCE",
        id: attendanceId,
        summary: `${record.date} ${outcome}`,
      },
      outcome: "SUCCESS",
      metadata: { attendanceId, outcome },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toReviewDto(review);
  }

  toDto(record, user, reviews = []) {
    const reviewDtos = reviews.map((review) => this.toReviewDto(review));
    return {
      id: String(record.id ?? record._id),
      userId: record.userId?.toString?.() ?? record.userId,
      date: record.date,
      clockInAt: record.clockInAt ? new Date(record.clockInAt).toISOString() : null,
      clockOutAt: record.clockOutAt ? new Date(record.clockOutAt).toISOString() : null,
      status: record.status,
      exceptionTypes: record.exceptionTypes ?? [],
      source: record.source,
      version: record.version,
      user: user
        ? { id: user.id, username: user.username, name: user.name }
        : null,
      reviews: reviewDtos,
      latestReview: reviewDtos[reviewDtos.length - 1] ?? null,
    };
  }

  toReviewDto(review) {
    return {
      id: String(review.id ?? review._id),
      attendanceId: review.attendanceId?.toString?.() ?? review.attendanceId,
      userId: review.userId?.toString?.() ?? review.userId,
      reviewerId: review.reviewerId?.toString?.() ?? review.reviewerId,
      outcome: review.outcome,
      comment: review.comment ?? "",
      createdAt: review.createdAt
        ? new Date(review.createdAt).toISOString()
        : null,
    };
  }
}

module.exports = { ExceptionReviewService };
