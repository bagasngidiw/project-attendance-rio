/**
 * AttendanceRepository — persistence for attendance records and the HR
 * overview (FR-035 / FR-041). Corrections are applied with an optimistic
 * version guard.
 */

const { AttendanceModel } = require("../models/attendance.model");
const { ConflictError } = require("../../domain/errors");

class AttendanceRepository {
  /** Unique record for a user and work day. */
  async findByUserAndDate(userId, date) {
    return AttendanceModel.findOne({ userId, date });
  }

  /** Creates the initial (clock-in) record for a work day. */
  async create({ userId, date, clockInAt, source = "SELF", exceptionTypes = [], status = "NORMAL", punctuality = null, clockInLocation = null, verification = null, scheduleSnapshot = null }) {
    return AttendanceModel.create({
      userId,
      date,
      clockInAt,
      clockOutAt: null,
      source,
      exceptionTypes,
      status,
      punctuality,
      clockInLocation,
      verification,
      scheduleSnapshot,
      version: 1,
    });
  }

  /** Persists clock-out / recomputed fields on the record. */
  async save(record) {
    return record.save();
  }

  /**
   * FR-001: creates a LEAVE attendance record for a `{userId, date}` only when
   * no record exists yet. Idempotent and non-destructive — an existing record
   * (e.g. the employee already clocked in) is never overwritten.
   *
   * @param {{ userId: string, date: string }} input
   */
  async createLeaveIfAbsent({ userId, date }) {
    const existing = await AttendanceModel.findOne({ userId, date });
    if (existing) return existing;
    return AttendanceModel.create({
      userId,
      date,
      clockInAt: null,
      clockOutAt: null,
      source: "SELF",
      exceptionTypes: [],
      status: "LEAVE",
      punctuality: null,
      version: 1,
    });
  }

  /**
   * Versioned correction: applies new field values only when the record is
   * still at the expected version (FR-020 optimistic concurrency).
   *
   * @param {string} id
   * @param {{ version: number, fields: object }} change
   */
  async applyCorrection(id, { version, fields }) {
    const updated = await AttendanceModel.findOneAndUpdate(
      { _id: id, version },
      { $set: { ...fields, version: version + 1 } },
      { returnDocument: "after" }
    );
    if (!updated) {
      throw new ConflictError(
        "The attendance record was modified concurrently. Reload and retry.",
        "ATTENDANCE_VERSION_CONFLICT"
      );
    }
    return updated;
  }

  /** @param {string} id */
  async findById(id) {
    return AttendanceModel.findById(id);
  }

  /** Owner-scoped lookup (personal history detail). */
  async findByIdScoped(id, userId) {
    return AttendanceModel.findOne({ _id: id, userId });
  }

  /**
   * Personal history: date-ordered, filtered, paginated (FR-035).
   *
   * @param {string} userId
   * @param {{ from?: string, to?: string, status?: string, page?: number, pageSize?: number }} filters
   */
  async findByUser(userId, { from, to, status, page = 1, pageSize = 20 } = {}) {
    const filter = { userId };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (status) filter.status = status;

    const [items, total] = await Promise.all([
      AttendanceModel.find(filter)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AttendanceModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  /**
   * HR overview query (FR-041): optional owner set (department/employee
   * filters resolved by the service), date range, status, and exception.
   *
   * @param {{ userIds?: string[], from?: string, to?: string, status?: string, exception?: string, page?: number, pageSize?: number }} filters
   */
  async queryOverview({ userIds, from, to, status, exception, page = 1, pageSize = 20 } = {}) {
    const filter = {};
    if (userIds && userIds.length > 0) filter.userId = { $in: userIds };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (status) filter.status = status;
    if (exception) filter.exceptionTypes = exception;

    const [items, total] = await Promise.all([
      AttendanceModel.find(filter)
        .sort({ date: -1, userId: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AttendanceModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  /** Open shifts for a set of users (PendingSummary "attendance" provider). */
  async countOpenShiftsForUserIds(userIds) {
    if (!userIds || userIds.length === 0) return 0;
    return AttendanceModel.countDocuments({
      userId: { $in: userIds },
      clockOutAt: null,
    });
  }

  /** Company-wide open shifts on a work day (FR-026 clocked-in count). */
  async countOpenShiftsByDate(date) {
    return AttendanceModel.countDocuments({ date, clockOutAt: null });
  }

  /** Distinct users with an attendance record on a work day. */
  async distinctUserIdsOnDate(date) {
    return AttendanceModel.distinct("userId", { date });
  }

  /** Records flagged EXCEPTION within an optional date range (FR-026). */
  async countExceptionsInRange({ from, to } = {}) {
    const filter = { status: "EXCEPTION" };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    return AttendanceModel.countDocuments(filter);
  }

  /** Correction history for a record (append-only). */
  async listCorrections(attendanceId) {
    const { AttendanceCorrectionModel } = require("../models/attendance-correction.model");
    return AttendanceCorrectionModel.find({ attendanceId })
      .sort({ correctedAt: 1, _id: 1 })
      .lean();
  }
}

module.exports = { AttendanceRepository };
