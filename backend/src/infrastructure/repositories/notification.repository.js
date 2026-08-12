/**
 * NotificationRepository — persistence for the in-app notification inbox
 * (FR-014). Unread items sort first, then newest; reads/marks are owner-scoped.
 */

const { NotificationModel } = require("../models/notification.model");

class NotificationRepository {
  /** @param {object} input */
  async create({ userId, type, title, body = "", link = "", relatedRequestId = null }) {
    return NotificationModel.create({
      userId,
      type,
      title,
      body,
      link,
      relatedRequestId: relatedRequestId ?? null,
      readAt: null,
    });
  }

  /**
   * Owner-scoped list, unread first then newest.
   *
   * @param {string} userId
   * @param {{ page?: number, pageSize?: number }} options
   */
  async listByUser(userId, { page = 1, pageSize = 20 } = {}) {
    const [items, total] = await Promise.all([
      NotificationModel.find({ userId })
        .sort({ readAt: 1, createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      NotificationModel.countDocuments({ userId }),
    ]);
    return { items, total };
  }

  /** @param {string} userId */
  async countUnread(userId) {
    return NotificationModel.countDocuments({ userId, readAt: null });
  }

  /** Marks one owned notification read. Returns the doc or null. */
  async markRead(id, userId) {
    return NotificationModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: { readAt: new Date() } },
      { returnDocument: "after" }
    );
  }

  /** Marks all owned notifications read. Returns the count updated. */
  async markAllRead(userId) {
    const result = await NotificationModel.updateMany(
      { userId, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return result.modifiedCount ?? 0;
  }
}

module.exports = { NotificationRepository };
