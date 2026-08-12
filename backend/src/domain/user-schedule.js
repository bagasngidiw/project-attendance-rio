/**
 * User work-schedule domain model (TODO.md §7/§8/§9/§10).
 *
 * Each employee has their own working days (0=Sun..6=Sat), working start/end
 * times, and per-leave-type quotas. The ABSENSI module consumes this schedule
 * as the source of truth (never hardcoded 08:00 / Monday-Friday).
 */

const { ValidationError } = require("./errors");

const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** @param {unknown} value */
function isHexInt(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function minutesOf(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Validates + normalizes a work schedule.
 *
 * @param {{ workingDays?: number[], workingStartTime?: string, workingEndTime?: string }} input
 */
function validateWorkSchedule({ workingDays, workingStartTime, workingEndTime } = {}) {
  const days = Array.isArray(workingDays)
    ? [...new Set(workingDays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  if (workingDays !== undefined && (!Array.isArray(workingDays) || days.length === 0)) {
    throw new ValidationError("Pilih minimal satu hari kerja.", { field: "workingDays" });
  }
  if (workingStartTime !== undefined && !isHexInt(workingStartTime)) {
    throw new ValidationError("Jam masuk harus format HH:MM.", { field: "workingStartTime" });
  }
  if (workingEndTime !== undefined && !isHexInt(workingEndTime)) {
    throw new ValidationError("Jam pulang harus format HH:MM.", { field: "workingEndTime" });
  }
  if (workingStartTime !== undefined && workingEndTime !== undefined) {
    if (minutesOf(workingStartTime) >= minutesOf(workingEndTime)) {
      throw new ValidationError("Jam pulang harus setelah jam masuk.", { field: "workingEndTime" });
    }
  }
  return {
    workingDays: days,
    workingStartTime: workingStartTime ?? "",
    workingEndTime: workingEndTime ?? "",
  };
}

/**
 * True when `date` is a configured working day for the user.
 * When the user has no workingDays configured, the default is Mon–Fri (1..5).
 *
 * @param {number[]} workingDays
 * @param {string} dateKey YYYY-MM-DD
 */
function isWorkingDay(workingDays, dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const days = Array.isArray(workingDays) && workingDays.length > 0 ? workingDays : [1, 2, 3, 4, 5];
  return days.includes(weekday);
}

/**
 * Attendance punctuality from the user's schedule (TODO.md §11/§12).
 * Returns null when the day is not a working day or no start time is set
 * (never mark late on a non-working day).
 *
 * @param {{ date: string, clockInAt: Date }} input
 * @param {{ workingDays?: number[], workingStartTime?: string }} schedule
 * @param {number} [timezoneOffsetMs]
 */
function computePunctuality({ date, clockInAt }, schedule = {}, timezoneOffsetMs = 0) {
  if (!clockInAt) return null;
  if (!isWorkingDay(schedule.workingDays ?? [], date)) return null;
  if (!schedule.workingStartTime || !isHexInt(schedule.workingStartTime)) return null;

  // Compare the clock-in instant against the scheduled start, both in the
  // company timezone.
  const local = new Date(new Date(clockInAt).getTime() + timezoneOffsetMs);
  const scheduledMinutes = minutesOf(schedule.workingStartTime);
  const actualMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return actualMinutes <= scheduledMinutes ? "ON_TIME" : "LATE";
}

/**
 * Validates a leave quota allocation.
 *
 * @param {{ leaveTypeId: string, allocatedDays: number }} input
 */
function validateQuotaAllocation({ leaveTypeId, allocatedDays }) {
  if (!leaveTypeId) {
    throw new ValidationError("Tipe cuti wajib dipilih.", { field: "leaveTypeId" });
  }
  if (!Number.isInteger(allocatedDays) || allocatedDays < 0 || allocatedDays > 365) {
    throw new ValidationError("Jatah cuti harus bilangan bulat 0..365.", { field: "allocatedDays" });
  }
}

module.exports = {
  TIME_PATTERN,
  validateWorkSchedule,
  isWorkingDay,
  computePunctuality,
  validateQuotaAllocation,
};
