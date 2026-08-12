/**
 * Mongoose schema + model for the `exception_reviews` collection
 * (FR-053). Append-only log of manager review outcomes against attendance
 * exception records. No update or delete paths exist in the application;
 * every review is a new document so the full review history is preserved.
 */

const mongoose = require("mongoose");

const EXCEPTION_REVIEW_OUTCOMES = Object.freeze([
  "CONFIRMED",
  "FLAGGED_HR",
  "REQUEST_CORRECTION",
]);

const exceptionReviewSchema = new mongoose.Schema(
  {
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    outcome: {
      type: String,
      enum: EXCEPTION_REVIEW_OUTCOMES,
      required: true,
    },
    comment: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

exceptionReviewSchema.index({ attendanceId: 1, createdAt: 1 });
exceptionReviewSchema.index({ reviewerId: 1, createdAt: 1 });
exceptionReviewSchema.index({ userId: 1, createdAt: 1 });

const ExceptionReviewModel = mongoose.model(
  "ExceptionReview",
  exceptionReviewSchema
);

module.exports = { ExceptionReviewModel, EXCEPTION_REVIEW_OUTCOMES };
