/**
 * AttendanceService — the attendance module (FR-035 / FR-020 / FR-041).
 *
 * Clock in/out with one-work-period-per-day enforcement, personal history,
 * HR-wide overview with exception detection, and append-only corrections.
 * Scope is enforced at the boundary (own records only; HR within their scope;
 * out-of-scope answers 404). Registers the "attendance" PendingSummary
 * provider so the team overview reflects open shifts.
 */

const {
  ATTENDANCE_STATUS,
  SOURCE_TYPES,
  toWorkDay,
  computeExceptions,
  computeStatus,
  assertClockInAllowed,
  assertClockOutAllowed,
  assertClockOutAfterIn,
  assertSelfCorrectionDenied,
  assertCorrectionReason,
  isLeaveRecord,
  assertClockAllowedOnLeave,
} = require("../domain/attendance");
const { computePunctuality } = require("../domain/user-schedule");
const { NotFoundError, ConflictError, ValidationError } = require("../domain/errors");

class AttendanceService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/attendance.repository').AttendanceRepository} deps.attendanceRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} [deps.requestRepository] FR-001 approved-leave coverage
   * @param {import('../infrastructure/repositories/attendance-correction.model').AttendanceCorrectionModel} deps.correctionModel
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {object} deps.config security config (timezone offset)
   * @param {() => Date} [deps.now] injectable clock (FR-060: UTC instants)
   */
  constructor({
    attendanceRepository,
    userRepository,
    requestRepository = null,
    correctionModel,
    pendingSummaryService,
    auditService,
    config,
    now = () => new Date(),
  }) {
    this.attendanceRepository = attendanceRepository;
    this.userRepository = userRepository;
    this.requestRepository = requestRepository;
    this.correctionModel = correctionModel;
    this.auditService = auditService;
    this.config = config;
    this.now = now;

    pendingSummaryService.registerProvider({
      module: "attendance",
      countPendingForUserIds: (userIds) =>
        this.attendanceRepository.countOpenShiftsForUserIds(userIds),
    });
  }

  /** Company-timezone work day for the given instant. */
  workDayFor(now = this.now()) {
    return toWorkDay(now, this.config?.security?.companyTimezoneOffsetMs ?? 0);
  }

  /**
   * FR-001: true when the user has an APPROVED leave covering the date. Falls
   * back to false when the request repository is not wired (unit tests).
   */
  async isOnApprovedLeave(userId, date) {
    if (!this.requestRepository) return false;
    const coverage = await this.requestRepository.findApprovedLeaveCovering({
      requesterId: userId,
      from: date,
      to: date,
    });
    return coverage.length > 0;
  }

  /**
   * FR-001: blocks clock in/out when the user's work day is covered by an
   * approved leave — whether the LEAVE record already exists or the sync
   * subscriber has not run yet.
   */
  async assertNotOnApprovedLeave(userId, date, todayRecord) {
    if (isLeaveRecord(todayRecord) || (await this.isOnApprovedLeave(userId, date))) {
      assertClockAllowedOnLeave(todayRecord);
    }
  }

  /**
   * Clocks the user in: opens today's work period (FR-035). Blocks a second
   * clock-in for the same day. Records the employee schedule snapshot
   * (FR-011) and the verification/location evidence (FR-008/FR-009/FR-012).
   * The server timestamp is authoritative (FR-010).
   */
  async clockIn(userId, actor = {}) {
    const date = this.workDayFor();
    const today = await this.attendanceRepository.findByUserAndDate(userId, date);
    // FR-001: approved leave blocks clock-in (record exists or coverage query).
    await this.assertNotOnApprovedLeave(userId, date, today);
    assertClockInAllowed(today);

    // TODO.md FR-006: verification policy — camera/location/accuracy.
    this.assertVerificationPolicy(actor, date);

    // TODO.md §11/§12: punctuality from the employee's configured schedule
    // (never hardcoded 08:00 / Mon-Fri). Non-working days are never "LATE".
    const user = await this.userRepository.findById(userId);
    const schedule = {
      workingDays: user?.workingDays ?? [],
      workingStartTime: user?.workingStartTime ?? "",
      workingEndTime: user?.workingEndTime ?? "",
    };
    const punctuality = computePunctuality(
      { date, clockInAt: this.now() },
      schedule,
      this.config?.security?.companyTimezoneOffsetMs ?? 0
    );

    const record = await this.attendanceRepository.create({
      userId,
      date,
      clockInAt: this.now(),
      source: SOURCE_TYPES.SELF,
      exceptionTypes: [],
      status: ATTENDANCE_STATUS.NORMAL,
      punctuality,
      clockInLocation: actor.location ?? null,
      verification: actor.verification ?? null,
      deviceInfo: actor.device ?? null,
      scheduleSnapshot: {
        ...schedule,
        evaluatedAt: this.now(),
      },
    });

    await this.auditService.record({
      action: "ATTENDANCE.CLOCKED_IN",
      actor: { userId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ATTENDANCE", id: record.id, summary: date },
      outcome: "SUCCESS",
      metadata: {
        date,
        locationStatus: actor.location?.acquisitionStatus ?? null,
        locationAccuracy: actor.location?.accuracy ?? null,
        cameraStatus: actor.verification?.camera?.status ?? null,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(record);
  }

  /**
   * Clocks the user out: closes today's open period (FR-035). Blocks when no
   * open period exists. The server timestamp is authoritative (FR-010).
   */
  async clockOut(userId, actor = {}) {
    const date = this.workDayFor();
    const today = await this.attendanceRepository.findByUserAndDate(userId, date);
    // FR-001: approved leave blocks clock-out (record exists or coverage query).
    await this.assertNotOnApprovedLeave(userId, date, today);
    assertClockOutAllowed(today);

    const clockOutAt = new Date(Math.max(this.now().getTime(), today.clockInAt.getTime() + 1));
    assertClockOutAfterIn(today.clockInAt, clockOutAt);

    today.clockOutAt = clockOutAt;
    if (actor.location) {
      today.clockOutLocation = actor.location;
    }
    this.refreshExceptions(today);
    await this.attendanceRepository.save(today);

    await this.auditService.record({
      action: "ATTENDANCE.CLOCKED_OUT",
      actor: { userId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ATTENDANCE", id: today.id, summary: date },
      outcome: "SUCCESS",
      metadata: {
        date,
        locationStatus: actor.location?.acquisitionStatus ?? null,
        locationAccuracy: actor.location?.accuracy ?? null,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(today);
  }

  /** Today's status for the clock panel (null when the user has not clocked in). */
  async getToday(userId) {
    const date = this.workDayFor();
    const record = await this.attendanceRepository.findByUserAndDate(userId, date);
    if (record) return this.toDto(record);
    // FR-001: fallback — the LEAVE sync may not have created the record yet
    // (e.g. leave approved minutes ago), so surface a leave marker directly.
    if (await this.isOnApprovedLeave(userId, date)) {
      return this.leaveMarkerDto(userId, date);
    }
    return null;
  }

  /** FR-001: synthetic LEAVE DTO for the clock panel on approved-leave days. */
  leaveMarkerDto(userId, date) {
    return {
      id: null,
      userId: String(userId),
      date,
      clockInAt: null,
      clockOutAt: null,
      status: ATTENDANCE_STATUS.LEAVE,
      punctuality: null,
      exceptionTypes: [],
      source: SOURCE_TYPES.SELF,
      version: null,
    };
  }

  /** Personal history with filters + pagination (FR-035). */
  async listOwn(userId, filters = {}) {
    const { items, total } = await this.attendanceRepository.findByUser(userId, filters);
    return {
      items: items.map((item) => this.toDto(item)),
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /**
   * Scoped detail + correction history. Owners (via `view_own`) and HR (via
   * `view_all`) may read; anyone else gets 404 (no existence leak).
   *
   * @param {string} id
   * @param {string} actorId
   * @param {{ canViewAll: boolean }} scope
   */
  async getByIdScoped(id, actorId, { canViewAll }) {
    const record = canViewAll
      ? await this.attendanceRepository.findById(id)
      : await this.attendanceRepository.findByIdScoped(id, actorId);
    if (!record) {
      throw new NotFoundError("Attendance record not found.", "ATTENDANCE_NOT_FOUND");
    }

    const corrections = await this.attendanceRepository.listCorrections(id);
    return {
      ...this.toDto(record),
      corrections: corrections.map((c) => this.correctionDto(c)),
    };
  }

  /**
   * HR overview (FR-041): filters employee, department, date range, status,
   * and exception. Department resolves to the department's user ids.
   */
  async listOverview({ actorId, canViewAll, filters = {} }) {
    if (!canViewAll) {
      throw new NotFoundError("Attendance overview not found.", "ATTENDANCE_NOT_FOUND");
    }

    let userIds;
    if (filters.departmentId) {
      const { items } = await this.userRepository.list({
        departmentId: filters.departmentId,
        page: 1,
        pageSize: 10000,
      });
      userIds = items.map((u) => String(u._id ?? u.id));
    }
    if (filters.employeeId) {
      userIds = [filters.employeeId];
    }

    const { items, total } = await this.attendanceRepository.queryOverview({
      userIds,
      from: filters.from,
      to: filters.to,
      status: filters.status,
      exception: filters.exception,
      page: filters.page,
      pageSize: filters.pageSize,
    });

    const enriched = await this.enrichUsers(items);
    return {
      items: enriched,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  /**
   * Applies an append-only correction (FR-020): verifies the caller is not the
   * owner and the oldValue matches the current value, then records the
   * correction, bumps the record version, recomputes exceptions, and audits.
   */
  async correct(id, { field, oldValue, newValue, reason }, actor = {}) {
    const record = await this.attendanceRepository.findById(id);
    if (!record) {
      throw new NotFoundError("Attendance record not found.", "ATTENDANCE_NOT_FOUND");
    }

    assertSelfCorrectionDenied(record.userId, actor.actorId);
    assertCorrectionReason(reason);

    const current = record[field] ? new Date(record[field]).toISOString() : null;
    const expectedOld = oldValue ? new Date(oldValue).toISOString() : null;
    if (current !== expectedOld) {
      throw new ConflictError(
        "The record changed since it was loaded. Reload and retry.",
        "ATTENDANCE_VERSION_CONFLICT"
      );
    }

    const oldValueDate = oldValue ? new Date(oldValue) : null;
    const newValueDate = newValue ? new Date(newValue) : null;

    const updated = await this.attendanceRepository.applyCorrection(id, {
      version: record.version,
      fields: {
        [field]: newValueDate,
        source: SOURCE_TYPES.CORRECTION,
      },
    });
    this.refreshExceptions(updated);
    // A corrected clock-in changes punctuality; a corrected clock-out does not.
    if (field === "clockInAt") {
      await this.refreshPunctuality(updated);
    }
    await updated.save();

    const correction = await this.correctionModel.create({
      attendanceId: id,
      field,
      oldValue: oldValueDate,
      newValue: newValueDate,
      reason,
      correctedBy: actor.actorId ?? null,
      correctedAt: this.now(),
    });

    await this.auditService.record({
      action: "ATTENDANCE.CORRECTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "ATTENDANCE", id, summary: `${record.date} ${field}` },
      outcome: "SUCCESS",
      metadata: {
        field,
        oldValue: oldValueDate ? oldValueDate.toISOString() : null,
        newValue: newValueDate ? newValueDate.toISOString() : null,
        reason,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.correctionDto(correction);
  }

  /** Recomputes exception types + status from the record's current fields. */
  refreshExceptions(record) {
    const exceptionTypes = computeExceptions(record);
    record.exceptionTypes = exceptionTypes;
    record.status = computeStatus(exceptionTypes);
    return record;
  }

  /**
   * TODO.md FR-006: enforces the attendance verification policy (camera /
   * location presence + accuracy threshold). The server is authoritative —
   * a client that skipped verification cannot submit.
   */
  assertVerificationPolicy(actor, date) {
    const policy = this.config?.security?.attendance ?? {};
    const camera = actor.verification?.camera;
    const location = actor.location;
    if (policy.requireCamera !== false && !camera?.mediaRef) {
      throw new ValidationError(
        "Verifikasi kamera diperlukan sebelum absen (foto belum diunggah).",
        { field: "camera" }
      );
    }
    if (policy.requireLocation !== false && !location?.latitude) {
      throw new ValidationError(
        "Verifikasi lokasi diperlukan sebelum absen.",
        { field: "location" }
      );
    }
    const maxAccuracy = Number(policy.maxAccuracyMeters ?? 0);
    if (maxAccuracy > 0 && location && Number(location.accuracy) > maxAccuracy) {
      throw new ValidationError(
        `Akurasi lokasi melebihi ambang batas (maks ${maxAccuracy} meter). Perbaiki sinyal GPS.`,
        { field: "location" }
      );
    }
  }

  /**
   * Recomputes punctuality (ON_TIME / LATE / null) from the employee's
   * configured schedule. Used after clock-in and after a clock-in correction.
   */
  async refreshPunctuality(record) {
    if (!record.clockInAt) {
      record.punctuality = null;
      return record;
    }
    const user = await this.userRepository.findById(record.userId);
    record.punctuality = computePunctuality(
      { date: record.date, clockInAt: record.clockInAt },
      {
        workingDays: user?.workingDays ?? [],
        workingStartTime: user?.workingStartTime ?? "",
      },
      this.config?.security?.companyTimezoneOffsetMs ?? 0
    );
    return record;
  }

  /** Enriches overview items with owner identity. */
  async enrichUsers(items) {
    return Promise.all(
      items.map(async (item) => {
        const user = await this.userRepository.findById(item.userId);
        return {
          ...this.toDto(item),
          user: user
            ? { id: user.id, username: user.username, name: user.name }
            : null,
        };
      })
    );
  }

  toDto(record) {
    return {
      id: String(record.id ?? record._id),
      userId: record.userId?.toString?.() ?? record.userId,
      date: record.date,
      clockInAt: record.clockInAt ? new Date(record.clockInAt).toISOString() : null,
      clockOutAt: record.clockOutAt ? new Date(record.clockOutAt).toISOString() : null,
      status: record.status,
      punctuality: record.punctuality ?? null,
      exceptionTypes: record.exceptionTypes ?? [],
      source: record.source,
      clockInLocation: record.clockInLocation ?? null,
      clockOutLocation: record.clockOutLocation ?? null,
      verification: record.verification ?? null,
      scheduleSnapshot: record.scheduleSnapshot ?? null,
      version: record.version,
    };
  }

  correctionDto(correction) {
    return {
      id: String(correction.id ?? correction._id),
      attendanceId: correction.attendanceId?.toString?.() ?? correction.attendanceId,
      field: correction.field,
      oldValue: correction.oldValue ? new Date(correction.oldValue).toISOString() : null,
      newValue: correction.newValue ? new Date(correction.newValue).toISOString() : null,
      reason: correction.reason,
      correctedBy: correction.correctedBy?.toString?.() ?? correction.correctedBy,
      correctedAt: correction.correctedAt ? new Date(correction.correctedAt).toISOString() : null,
    };
  }
}

module.exports = { AttendanceService };
