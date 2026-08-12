/**
 * Mongoose schema + model for the `attendance_corrections` collection
 * (design §7.2). Append-only record of every attendance correction: the prior
 * value, the corrected value, the actor, and the reason. No update or delete
 * paths exist in the application.
 */

const mongoose = require("mongoose");

const CORRECTABLE_FIELDS = Object.freeze(["clockInAt", "clockOutAt"]);

const attendanceCorrectionSchema = new mongoose.Schema(
  {
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true,
    },
    field: { type: String, enum: CORRECTABLE_FIELDS, required: true },
    oldValue: { type: Date, default: null },
    newValue: { type: Date, default: null },
    reason: { type: String, required: true },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    correctedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

attendanceCorrectionSchema.index({ attendanceId: 1, correctedAt: 1 });
attendanceCorrectionSchema.index({ correctedBy: 1 });

const AttendanceCorrectionModel = mongoose.model(
  "AttendanceCorrection",
  attendanceCorrectionSchema
);

module.exports = { AttendanceCorrectionModel, CORRECTABLE_FIELDS };
