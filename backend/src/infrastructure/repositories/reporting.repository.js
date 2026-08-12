/**
 * ReportingRepository — persistence for the reporting line (FR-043).
 * Appends manager-change history entries and reads them for review. The
 * current manager lives on `users.managerId` (handled by the user repository).
 */

const { ReportingHistoryModel } = require("../models/reporting-history.model");

class ReportingRepository {
  /**
   * Appends a manager assignment/reassignment record (append-only).
   *
   * @param {{ userId: string, oldManagerId?: string|null, newManagerId?: string|null, changedBy?: string|null }} input
   */
  async append({ userId, oldManagerId = null, newManagerId = null, changedBy = null }) {
    return ReportingHistoryModel.create({
      userId,
      oldManagerId: oldManagerId ?? null,
      newManagerId: newManagerId ?? null,
      changedBy: changedBy ?? null,
      changedAt: new Date(),
    });
  }

  /** Full manager-change history for a user, oldest first. */
  async findByUserId(userId) {
    return ReportingHistoryModel.find({ userId })
      .sort({ changedAt: 1, _id: 1 })
      .lean();
  }
}

module.exports = { ReportingRepository };
