/**
 * ExceptionReviewRepository — persistence for manager exception reviews
 * (FR-053). Reads are scoped by attendance record, reviewer, or employee.
 */

const { ExceptionReviewModel } = require("../models/exception-review.model");

class ExceptionReviewRepository {
  /** Appends a review outcome for an attendance record. */
  async create(data) {
    return ExceptionReviewModel.create(data);
  }

  /** Full review history for one attendance record (append-only, oldest first). */
  async findByAttendanceId(attendanceId) {
    return ExceptionReviewModel.find({ attendanceId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  /** Reviews authored by a reviewer (newest first). */
  async listByReviewer(reviewerId) {
    return ExceptionReviewModel.find({ reviewerId })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
  }

  /** Reviews authored against a specific employee's records (newest first). */
  async listByUser(userId) {
    return ExceptionReviewModel.find({ userId })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
  }
}

module.exports = { ExceptionReviewRepository };
