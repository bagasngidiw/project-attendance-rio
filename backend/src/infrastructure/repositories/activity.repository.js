/**
 * ActivityLogRepository — append-only persistence for the operational
 * activity surface (FR-013).
 */

const { ActivityLogModel } = require("../models/activity-log.model");

class ActivityLogRepository {
  /**
   * @param {object} record
   * @param {string} record.action
   * @param {object} record.actor
   * @param {object} [record.subject]
   * @param {string} [record.correlationId]
   */
  async insert(record) {
    await ActivityLogModel.create({
      action: record.action,
      category: "ACTIVITY",
      actor: { userId: record.actor?.userId ?? null },
      subject: {
        type: record.subject?.type ?? "",
        id: record.subject?.id ?? "",
        summary: record.subject?.summary ?? "",
      },
      correlationId: record.correlationId ?? "",
      recordedAt: new Date(),
    });
  }

  /**
   * @param {object} filters same shape as AuditEventRepository.query
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async query({ from, to, actorId, action, subjectType, correlationId, page = 1, pageSize = 20 }, scope = {}) {
    const filter = {};

    if (from || to) {
      filter.recordedAt = {};
      if (from) filter.recordedAt.$gte = new Date(from);
      if (to) filter.recordedAt.$lte = new Date(to);
    }
    if (actorId) filter["actor.userId"] = actorId;
    if (action) filter.action = action;
    if (subjectType) filter["subject.type"] = subjectType;
    if (correlationId) filter.correlationId = correlationId;
    if (scope.actorId) filter["actor.userId"] = scope.actorId;

    const [items, total] = await Promise.all([
      ActivityLogModel.find(filter)
        .sort({ recordedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      ActivityLogModel.countDocuments(filter),
    ]);

    return { items, total };
  }
}

module.exports = { ActivityLogRepository };
