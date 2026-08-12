/**
 * EscalationRepository — persistence for requester escalations (FR-063).
 */

const { EscalationModel } = require("../models/escalation.model");

class EscalationRepository {
  /**
   * @param {{ requestId: string, escalatorId: string, targetRoleLevel?: number, message?: string }} input
   */
  async create({ requestId, escalatorId, targetRoleLevel = null, message = "" }) {
    return EscalationModel.create({ requestId, escalatorId, targetRoleLevel, message });
  }

  /**
   * Counts escalations for a request within a time window (rate limiting).
   *
   * @param {string} requestId
   * @param {Date} since
   */
  async countByRequestSince(requestId, since) {
    return EscalationModel.countDocuments({
      requestId,
      createdAt: { $gte: since },
    });
  }

  /** Escalation history for a request, oldest first. */
  async listByRequest(requestId) {
    return EscalationModel.find({ requestId }).sort({ createdAt: 1, _id: 1 });
  }
}

module.exports = { EscalationRepository };
