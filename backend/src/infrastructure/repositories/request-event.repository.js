/**
 * RequestEventRepository — append-only request history (FR-008 base).
 * Records are never updated or deleted.
 */

const { RequestEventModel } = require("../models/request-event.model");

class RequestEventRepository {
  /**
   * Appends a history entry for a lifecycle transition.
   *
   * @param {{ requestId: string, event: string, actorId?: string, actorNameSnapshot?: string, actorRoleId?: string, actorRoleNameSnapshot?: string, comment?: string, fromStatus?: string, toStatus: string }} input
   */
  async append({ requestId, event, actorId = null, actorNameSnapshot = null, actorRoleId = null, actorRoleNameSnapshot = null, comment = "", fromStatus = "", toStatus }) {
    return RequestEventModel.create({
      requestId,
      event,
      actorId,
      actorNameSnapshot,
      actorRoleId,
      actorRoleNameSnapshot,
      comment,
      fromStatus,
      toStatus,
      recordedAt: new Date(),
    });
  }

  /**
   * Full transition timeline for a request, oldest first.
   *
   * @param {string} requestId
   */
  async findByRequestId(requestId) {
    return RequestEventModel.find({ requestId })
      .sort({ recordedAt: 1, _id: 1 })
      .lean();
  }
}

module.exports = { RequestEventRepository };
