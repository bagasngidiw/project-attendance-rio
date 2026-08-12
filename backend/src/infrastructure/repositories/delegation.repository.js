/**
 * DelegationRepository — persistence for approval delegations (FR-009).
 * Revocation is a soft state change on ACTIVE documents only; the record is
 * kept for auditability.
 */

const { DelegationModel } = require("../models/delegation.model");

class DelegationRepository {
  /**
   * @param {{ delegatorId: string, delegateId: string, requestTypes?: string[], startsAt: Date, endsAt: Date }} input
   */
  async create({ delegatorId, delegateId, requestTypes = [], startsAt, endsAt }) {
    return DelegationModel.create({
      delegatorId,
      delegateId,
      requestTypes,
      startsAt,
      endsAt,
      status: "ACTIVE",
      revokedAt: null,
      revokedBy: null,
    });
  }

  /** @param {string} id */
  async findById(id) {
    return DelegationModel.findById(id);
  }

  /** Delegations created by an approver, newest first. */
  async findByDelegator(delegatorId) {
    return DelegationModel.find({ delegatorId }).sort({ createdAt: -1, _id: -1 });
  }

  /** Delegations granted to a delegate, newest first. */
  async findByDelegate(delegateId) {
    return DelegationModel.find({ delegateId }).sort({ createdAt: -1, _id: -1 });
  }

  /**
   * FR-063: ACTIVE delegations granted to a delegate whose window is still
   * current — used by the unified approval inbox to include requests
   * delegated to the caller.
   *
   * @param {string} delegateId
   */
  async findActiveByDelegate(delegateId) {
    const now = new Date();
    return DelegationModel.find({
      delegateId,
      status: "ACTIVE",
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    }).sort({ createdAt: -1, _id: -1 });
  }

  /**
   * ACTIVE delegations of one approver whose window overlaps the given date.
   * The caller (domain/service) still applies request-type coverage.
   *
   * @param {string} delegatorId
   * @param {Date} date
   */
  async findActiveForDelegator(delegatorId, date) {
    const onDate = new Date(date);
    return DelegationModel.find({
      delegatorId,
      status: "ACTIVE",
      startsAt: { $lte: onDate },
      endsAt: { $gte: onDate },
    }).sort({ createdAt: -1, _id: -1 });
  }

  /**
   * Soft-revokes an ACTIVE delegation. Returns the updated doc or null when
   * the delegation is missing or already revoked.
   *
   * @param {string} id
   * @param {{ revokedBy: string }} input
   */
  async revoke(id, { revokedBy }) {
    return DelegationModel.findOneAndUpdate(
      { _id: id, status: "ACTIVE" },
      { $set: { status: "REVOKED", revokedAt: new Date(), revokedBy } },
      { returnDocument: "after" }
    );
  }

  /** Every ACTIVE delegation — used by the escalation sweep (FR-009). */
  async listActive() {
    return DelegationModel.find({ status: "ACTIVE" });
  }
}

module.exports = { DelegationRepository };
