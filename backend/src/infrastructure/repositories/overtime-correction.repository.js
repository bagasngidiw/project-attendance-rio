/**
 * OvertimeCorrectionRepository — persistence for append-only overtime
 * corrections (FR-055).
 */

const { OvertimeCorrectionModel } = require("../models/overtime-correction.model");

class OvertimeCorrectionRepository {
  /** Appends a correction entry for an overtime request. */
  async create(data) {
    return OvertimeCorrectionModel.create(data);
  }

  /** Full correction history for one overtime request (append-only, oldest first). */
  async findByOvertimeId(overtimeId) {
    return OvertimeCorrectionModel.find({ overtimeId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  /** Alias for findByOvertimeId — full history for the detail surface. */
  async listByOvertime(overtimeId) {
    return this.findByOvertimeId(overtimeId);
  }
}

module.exports = { OvertimeCorrectionRepository };
