/**
 * OutboxRepository — transactional staging for the capture pipeline
 * (design §7.3). Events are enqueued here before dispatch; a dispatcher drains
 * PENDING entries with retry so logging never blocks core operations.
 */

const { OutboxModel, OUTBOX_STATUS } = require("../models/outbox.model");

class OutboxRepository {
  /** @param {string} eventType @param {object} payload */
  async enqueue(eventType, payload) {
    return OutboxModel.create({
      eventType,
      payload,
      status: OUTBOX_STATUS.PENDING,
      attemptCount: 0,
    });
  }

  /**
   * Claims up to `limit` PENDING entries for dispatch (FIFO).
   * @returns {Promise<object[]>} claimed documents
   */
  async claimPending(limit = 100) {
    return OutboxModel.find({ status: OUTBOX_STATUS.PENDING })
      .sort({ createdAt: 1 })
      .limit(limit);
  }

  async markPublished(id) {
    await OutboxModel.updateOne(
      { _id: id },
      { $set: { status: OUTBOX_STATUS.PUBLISHED } }
    );
  }

  async markFailed(id, errorMessage) {
    await OutboxModel.updateOne(
      { _id: id },
      {
        $inc: { attemptCount: 1 },
        $set: { status: OUTBOX_STATUS.FAILED, lastError: errorMessage },
      }
    );
  }

  async countPending() {
    return OutboxModel.countDocuments({ status: OUTBOX_STATUS.PENDING });
  }
}

module.exports = { OutboxRepository, OUTBOX_STATUS };
