/**
 * HolidayRepository — persistence for company holidays (FR-059).
 * Active-only reads back the working-day logic; deactivation preserves
 * history for auditability.
 */

const { HolidayModel } = require("../models/holiday.model");
const { NotFoundError } = require("../../domain/errors");

class HolidayRepository {
  async create({ date, name, repeatYearly = false, updatedBy = null }) {
    return HolidayModel.create({
      date,
      name,
      repeatYearly,
      status: "ACTIVE",
      updatedBy: updatedBy ?? null,
    });
  }

  async getById(id) {
    const doc = await HolidayModel.findById(id);
    if (!doc) throw new NotFoundError("Holiday not found.", "HOLIDAY_NOT_FOUND");
    return doc;
  }

  async listActive() {
    return HolidayModel.find({ status: "ACTIVE" }).sort({ date: 1 }).lean();
  }

  async listActiveBetween(from, to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return HolidayModel.find({
      status: "ACTIVE",
      date: { $gte: fromDate, $lte: toDate },
    })
      .sort({ date: 1 })
      .lean();
  }

  async update(id, input) {
    return HolidayModel.findByIdAndUpdate(
      id,
      { $set: input },
      { returnDocument: "after", runValidators: true }
    );
  }

  async setStatus(id, status, updatedBy) {
    return HolidayModel.findByIdAndUpdate(
      id,
      { $set: { status, updatedBy: updatedBy ?? null } },
      { returnDocument: "after" }
    );
  }

  async listAll() {
    return HolidayModel.find().sort({ date: 1 }).lean();
  }
}

module.exports = { HolidayRepository };
