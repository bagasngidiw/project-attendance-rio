/**
 * SalarySlipRepository — persistence for salary invoice slips (FR-006).
 * Follows the AttachmentRepository pattern: plain class, static model import.
 */

const { SalarySlipModel } = require("../models/salary-slip.model");

class SalarySlipRepository {
  /**
   * @param {{ userId: string, senderId: string, payDate: Date, periodLabel: string, notes: string, fileName: string, mimeType: string, sizeBytes: number, storageKey: string }} input
   */
  async create(input) {
    return SalarySlipModel.create(input);
  }

  /** @param {string} id */
  async findById(id) {
    return SalarySlipModel.findById(id);
  }

  /**
   * Paginated list of one recipient's slips, newest pay date first.
   *
   * @param {string} userId
   * @param {{ page?: number, pageSize?: number }} options
   */
  async listByUser(userId, { page = 1, pageSize = 20 } = {}) {
    const filter = { userId };
    const [items, total] = await Promise.all([
      SalarySlipModel.find(filter)
        .sort({ payDate: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      SalarySlipModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Paginated list of every slip (SUPERADMIN surface), newest first.
   *
   * @param {{ page?: number, pageSize?: number }} options
   */
  async listAll({ page = 1, pageSize = 20 } = {}) {
    const [items, total] = await Promise.all([
      SalarySlipModel.find({})
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      SalarySlipModel.countDocuments({}),
    ]);
    return { items, total };
  }
}

module.exports = { SalarySlipRepository };