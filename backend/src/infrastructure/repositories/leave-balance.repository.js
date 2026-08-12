/**
 * LeaveBalanceRepository — persistence for leave balances (FR-022).
 * Counters are mutated with atomic `$inc` updates (upserting the balance row
 * on first touch) so concurrent approvals/adjustments never lose a day.
 */

const { LeaveBalanceModel } = require("../models/leave-balance.model");

const BALANCE_FIELDS = Object.freeze([
  "entitlementDays",
  "adjustmentDays",
  "consumedDays",
  "reservedDays",
]);

class LeaveBalanceRepository {
  async findByUserAndType(userId, leaveTypeId, year) {
    return LeaveBalanceModel.findOne({ userId, leaveTypeId, year }).lean();
  }

  async listByUser(userId, year) {
    return LeaveBalanceModel.find({ userId, year }).lean();
  }

  async listByUsers(userIds, year) {
    return LeaveBalanceModel.find({ userId: { $in: userIds }, year }).lean();
  }

  /**
   * Creates or updates a balance row, setting the provided counter fields.
   *
   * @param {string} userId
   * @param {string} leaveTypeId
   * @param {number} year
   * @param {{ entitlementDays?: number, adjustmentDays?: number, consumedDays?: number, reservedDays?: number }} fields
   */
  async upsert(userId, leaveTypeId, year, fields = {}) {
    const set = {};
    for (const key of BALANCE_FIELDS) {
      if (fields[key] !== undefined) set[key] = fields[key];
    }
    return LeaveBalanceModel.findOneAndUpdate(
      { userId, leaveTypeId, year },
      { $set: set },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
  }

  /**
   * Atomically increments balance counters, creating the row if missing
   * (a fresh row starts with every counter at 0 and the deltas applied).
   *
   * @param {string} userId
   * @param {string} leaveTypeId
   * @param {number} year
   * @param {{ deltaEntitlement?: number, deltaAdjustment?: number, deltaConsumed?: number, deltaReserved?: number }} deltas
   */
  async adjust(
    userId,
    leaveTypeId,
    year,
    { deltaEntitlement = 0, deltaAdjustment = 0, deltaConsumed = 0, deltaReserved = 0 } = {}
  ) {
    const inc = {};
    if (deltaEntitlement !== 0) inc.entitlementDays = deltaEntitlement;
    if (deltaAdjustment !== 0) inc.adjustmentDays = deltaAdjustment;
    if (deltaConsumed !== 0) inc.consumedDays = deltaConsumed;
    if (deltaReserved !== 0) inc.reservedDays = deltaReserved;
    return LeaveBalanceModel.findOneAndUpdate(
      { userId, leaveTypeId, year },
      { $inc: inc },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
  }
}

module.exports = { LeaveBalanceRepository };
