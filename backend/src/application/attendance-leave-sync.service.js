/**
 * AttendanceLeaveSyncService (FR-001) — cross-module EventBus subscriber that
 * turns APPROVED leave into attendance LEAVE records.
 *
 * When a LEAVE request is decided APPROVED, this service creates a LEAVE
 * attendance record for every covered date (`payload.startDate`..`payload.endDate`,
 * inclusive, YYYY-MM-DD) — but ONLY when no record exists for that `{userId, date}`.
 * Existing attendance (e.g. the employee already clocked in) is never touched,
 * and rejected/cancelled leave produces nothing.
 *
 * The subscriber is additive and non-throwing: a sync failure must never break
 * the decision flow, so every failure is logged and swallowed.
 */

const ATTENDANCE_STATUS_LEAVE = "LEAVE";

class AttendanceLeaveSyncService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/attendance.repository').AttendanceRepository} deps.attendanceRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {object} [deps.logger] structured logger (defaults to console)
   */
  constructor({ attendanceRepository, requestRepository, logger = console }) {
    this.attendanceRepository = attendanceRepository;
    this.requestRepository = requestRepository;
    this.logger = logger;
  }

  /** Subscribes to the request lifecycle events (additive; mirrors leave-balance). */
  subscribeToEvents(eventBus) {
    eventBus.subscribe("request.decided", (payload) => this.onDecided(payload));
  }

  /**
   * request.decided → for APPROVED LEAVE only, create leave attendance records
   * for each covered date. Never throws to the publisher.
   *
   * @param {{ requestId?: string, type?: string, toStatus?: string }} payload
   */
  async onDecided(payload = {}) {
    if (String(payload?.type ?? "").toUpperCase() !== "LEAVE") return;
    if (payload?.toStatus !== "APPROVED") return;

    try {
      const request = await this.requestRepository.findById(payload.requestId);
      if (!request) return;
      const startDate = request.payload?.startDate;
      const endDate = request.payload?.endDate;
      if (!startDate || !endDate) return;

      const requesterId = String(request.requesterId);
      for (const date of enumerateDateKeys(startDate, endDate)) {
        await this.attendanceRepository.createLeaveIfAbsent({ userId: requesterId, date });
      }
    } catch (err) {
      this.logger.error(
        "[attendance-leave-sync] failed to create leave attendance records:",
        err
      );
    }
  }
}

/** Inclusive iteration of YYYY-MM-DD date keys between two bounds. */
function enumerateDateKeys(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

module.exports = { AttendanceLeaveSyncService, enumerateDateKeys };
