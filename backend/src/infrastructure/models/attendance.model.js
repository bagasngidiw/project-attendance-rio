/**
 * Mongoose schema + model for the `attendance` collection (design §7.1).
 *
 * One record per user per work day (`date` in company timezone). Clock
 * instants are stored as UTC. `status`/`exceptionTypes` are derived by the
 * domain and refreshed on every mutation. `version` guards corrections.
 */

const mongoose = require("mongoose");

const ATTENDANCE_STATUSES = Object.freeze(["NORMAL", "EXCEPTION", "LEAVE"]);
/** TODO.md §12: schedule-based punctuality (may be null on non-working days). */
const PUNCTUALITY_STATUSES = Object.freeze(["ON_TIME", "LATE"]);
const EXCEPTION_TYPES = Object.freeze([
  "MISSING_CLOCK_IN",
  "MISSING_CLOCK_OUT",
  "DUPLICATE",
  "CONFLICT",
  "ANOMALY",
]);
const SOURCE_TYPES = Object.freeze(["SELF", "CORRECTION"]);

const attendanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: String, required: true }, // YYYY-MM-DD (company timezone)
    clockInAt: { type: Date, default: null },
    clockOutAt: { type: Date, default: null },
    // TODO.md FR-009: geolocation evidence for each clock event. Stored on the
    // record only; audit logs carry accuracy/status, never raw coordinates.
    clockInLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      timestamp: { type: Date, default: null },
      permissionState: { type: String, default: "" },
      acquisitionStatus: { type: String, default: "" },
    },
    clockOutLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      timestamp: { type: Date, default: null },
      permissionState: { type: String, default: "" },
      acquisitionStatus: { type: String, default: "" },
    },
    // TODO.md FR-012: verification summary (camera/selfie + location readiness).
    verification: {
      camera: {
        status: { type: String, default: "" },
        capturedAt: { type: Date, default: null },
        mediaRef: { type: String, default: null },
      },
      location: {
        status: { type: String, default: "" },
        acquiredAt: { type: Date, default: null },
      },
    },
    // TODO.md FR-006: operational device metadata (category/browser/OS/caps).
    deviceInfo: { type: mongoose.Schema.Types.Mixed, default: null },
    // TODO.md FR-011: employee schedule snapshot captured at clock-in so
    // historical statuses stay stable when the schedule later changes.
    scheduleSnapshot: {
      workingDays: { type: [Number], default: [] },
      workingStartTime: { type: String, default: "" },
      workingEndTime: { type: String, default: "" },
      evaluatedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      default: "NORMAL",
      index: true,
    },
    punctuality: {
      type: String,
      enum: PUNCTUALITY_STATUSES,
      default: null,
      index: true,
    },
    exceptionTypes: { type: [String], default: [] },
    source: { type: String, enum: SOURCE_TYPES, default: "SELF" },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

const AttendanceModel = mongoose.model("Attendance", attendanceSchema);

module.exports = {
  AttendanceModel,
  ATTENDANCE_STATUSES,
  PUNCTUALITY_STATUSES,
  EXCEPTION_TYPES,
  SOURCE_TYPES,
};
