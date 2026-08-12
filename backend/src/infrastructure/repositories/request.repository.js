/**
 * RequestRepository — persistence for the polymorphic request store
 * (design §7.1). Optimistic locking guards every status transition so
 * concurrent decisions never overwrite each other.
 */

const { RequestModel } = require("../models/request.model");
const { ConflictError } = require("../../domain/errors");

class RequestRepository {
  /**
   * Creates a request (initially DRAFT).
   *
   * @param {{ type: string, requesterId: string, payload: object, status?: string }} input
   */
  async create({ type, requesterId, payload, status = "DRAFT" }) {
    return RequestModel.create({
      type,
      requesterId,
      payload: payload ?? {},
      status,
      version: 1,
    });
  }

  /** @param {string} id */
  async findById(id) {
    return RequestModel.findById(id);
  }

  /**
   * FR-001: finds APPROVED LEAVE requests whose date range overlaps `[from, to]`
   * for a requester. Used by the attendance service to block clock in/out on
   * approved leave days and to surface a LEAVE marker in `getToday`.
   *
   * @param {{ requesterId: string, from: string, to: string }} input date keys YYYY-MM-DD
   */
  async findApprovedLeaveCovering({ requesterId, from, to }) {
    return RequestModel.find({
      requesterId,
      type: "LEAVE",
      status: "APPROVED",
      "payload.startDate": { $lte: to },
      "payload.endDate": { $gte: from },
    }).lean();
  }

  /**
   * Requester-scoped lookup: returns the request ONLY when it belongs to the
   * given user; otherwise null (the caller answers 404 — no existence leak).
   *
   * @param {string} id
   * @param {string} requesterId
   */
  async findScoped(id, requesterId) {
    return RequestModel.findOne({ _id: id, requesterId });
  }

  /**
   * Paginated requester history with filters (FR-037 foundation).
   *
   * @param {string} requesterId
   * @param {{ status?: string, type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async findByRequesterId(requesterId, { status, type, from, to, page = 1, pageSize = 20 } = {}) {
    const filter = { requesterId };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (from || to) {
      filter.submittedAt = {};
      if (from) filter.submittedAt.$gte = new Date(from);
      if (to) filter.submittedAt.$lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      RequestModel.find(filter)
        .sort({ submittedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      RequestModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  /**
   * FR-002/FR-010: atomically claims a role-targeted PENDING request for a
   * user. The conditional filter (null assignment + PENDING) guarantees only
   * one approver can win a claim race.
   *
   * @param {string} id
   * @param {string} userId
   */
  async claimForUser(id, userId) {
    const now = new Date();
    return RequestModel.findOneAndUpdate(
      {
        _id: id,
        status: "PENDING",
        "approval.targetType": "ROLE",
        "approval.assignedUserId": null,
      },
      {
        $set: {
          "approval.assignedUserId": userId,
          "approval.assignedAt": now,
          approverId: userId,
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after", runValidators: true }
    );
  }

  /**
   * Optimistic status transition. The `version` guard rejects stale writes.
   *
   * @param {string} id
   * @param {object} change
   * @param {string} change.toStatus
   * @param {number} change.version expected version
   * @param {object} [change.fields] extra fields (approverId, timestamps, reason)
   */
  async updateStatus(id, { toStatus, version, fields = {} }) {
    const updated = await RequestModel.findOneAndUpdate(
      { _id: id, version },
      { $set: { status: toStatus, version: version + 1, ...fields } },
      { returnDocument: "after" }
    );
    if (!updated) {
      throw new ConflictError(
        "The request was modified concurrently. Reload and retry.",
        "REQUEST_VERSION_CONFLICT"
      );
    }
    return updated;
  }

  /**
   * Counts PENDING requests owned by the given users — the shared
   * PendingSummary provider primitive (FR-006).
   *
   * @param {string[]} userIds
   * @param {string} [type] restrict to a request type (LEAVE | OVERTIME | TRIP)
   */
  async countPendingForUserIds(userIds, type) {
    if (!userIds || userIds.length === 0) return 0;
    const filter = { requesterId: { $in: userIds }, status: "PENDING" };
    if (type) filter.type = type;
    return RequestModel.countDocuments(filter);
  }

  /**
   * Approval inbox/history query (FR-007): requests assigned to an approver,
   * optionally filtered by status, type, and submission window.
   *
   * @param {string} approverId
   * @param {{ status?: string, type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async findByApprover(approverId, { status, type, from, to, page = 1, pageSize = 20 } = {}) {
    return this.findWithFilters({ approverId, status, type, from, to, page, pageSize });
  }

  /**
   * Requests decided by a specific actor (FR-008 approver history): uses the
   * embedded `decision.actorId` so "decided by me" is precise.
   *
   * @param {string} actorId
   * @param {{ type?: string, from?: string, to?: string, page?: number, pageSize?: number }} filters
   */
  async findByDecidedBy(actorId, { type, from, to, page = 1, pageSize = 20 } = {}) {
    return this.findWithFilters(
      { "decision.actorId": actorId, status: { $in: ["APPROVED", "REJECTED"] }, type, from, to, page, pageSize },
      { field: "decidedAt" }
    );
  }

  /** Shared paginated query over the requests collection. */
  async findWithFilters({ requesterId, approverId, status, type, from, to, page = 1, pageSize = 20, extra = {} } = {}, { field = "submittedAt" } = {}) {    const filter = { ...extra };
    if (requesterId) filter.requesterId = requesterId;
    if (approverId) filter.approverId = approverId;
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (from || to) {
      filter[field] = {};
      if (from) filter[field].$gte = new Date(from);
      if (to) filter[field].$lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      RequestModel.find(filter)
        .sort({ [field]: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      RequestModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  /**
   * Dashboard aggregate for one user's requests (FR-025): counts per status
   * and per request type.
   *
   * @param {string|object} requesterId
   */
  async countSummaryForUser(requesterId) {
    // Aggregation pipelines do NOT apply Mongoose casting, so normalize the
    // id to an ObjectId up front (countDocuments casts strings automatically).
    const oid = RequestModel.base.Types.ObjectId.isValid(requesterId)
      ? new RequestModel.base.Types.ObjectId(requesterId)
      : requesterId;

    const [pending, approved, rejected, cancelled] = await Promise.all([
      RequestModel.countDocuments({ requesterId: oid, status: "PENDING" }),
      RequestModel.countDocuments({ requesterId: oid, status: "APPROVED" }),
      RequestModel.countDocuments({ requesterId: oid, status: "REJECTED" }),
      RequestModel.countDocuments({ requesterId: oid, status: "CANCELLED" }),
    ]);

    const byTypeRows = await RequestModel.aggregate([
      { $match: { requesterId: oid } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]);
    const byType = { leave: 0, overtime: 0, trip: 0 };
    for (const row of byTypeRows) {
      const key = String(row._id).toLowerCase();
      if (byType[key] !== undefined) byType[key] = row.count;
    }

    return { pending, approved, rejected, cancelled, byType };
  }

  /**
   * Most recently decided requests company-wide (FR-026 HR dashboard).
   *
   * @param {{ limit?: number }} options
   */
  async findRecentDecisions({ limit = 5 } = {}) {
    return RequestModel.find({
      status: { $in: ["APPROVED", "REJECTED"] },
      decidedAt: { $ne: null },
    })
      .sort({ decidedAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  }
}

module.exports = { RequestRepository };
