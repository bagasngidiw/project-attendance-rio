/**
 * AuditEventRepository — append-only persistence for the hash-chained audit
 * trail (FR-012). Only ever inserts; never updates or deletes.
 */

const { AuditEventModel } = require("../models/audit-event.model");
const { computeEventHash } = require("../../domain/audit");

class AuditEventRepository {
  /**
   * Appends an audit event with hash chaining: the new event's `prevHash` is
   * the previous event's `hash`; its own `hash` is computed over canonical
   * fields + a server salt.
   *
   * @param {object} event
   * @param {string} event.action
   * @param {object} event.actor
   * @param {object} event.subject
   * @param {string} event.outcome
   * @param {object} [event.metadata]
   * @param {string} [event.correlationId]
   * @param {string} [event.ip]
   * @param {string} [event.userAgent]
   * @param {string} salt server-side chain salt
   */
  async append(event, salt) {
    const previous = await AuditEventModel.findOne()
      .sort({ recordedAt: -1, _id: -1 })
      .select("hash")
      .lean();

    const prevHash = previous?.hash ?? "";
    const recordedAt = new Date().toISOString();

    const hash = computeEventHash({
      prevHash,
      action: event.action,
      actorUserId: event.actor?.userId?.toString?.() ?? "",
      subjectId: event.subject?.id ?? "",
      outcome: event.outcome,
      recordedAt,
      salt,
    });

    await AuditEventModel.create({
      action: event.action,
      category: "AUDIT",
      actor: {
        userId: event.actor?.userId ?? null,
        roleKeys: event.actor?.roleKeys ?? [],
        scope: event.actor?.scope ?? "",
      },
      subject: {
        type: event.subject?.type ?? "",
        id: event.subject?.id ?? "",
        summary: event.subject?.summary ?? "",
      },
      outcome: event.outcome ?? "SUCCESS",
      metadata: event.metadata ?? {},
      correlationId: event.correlationId ?? "",
      ip: event.ip ?? "",
      userAgent: event.userAgent ?? "",
      prevHash,
      hash,
      recordedAt: new Date(recordedAt),
    });

    return { prevHash, hash };
  }

  /**
   * Verifies the hash chain from the earliest stored event to the latest.
   *
   * @param {string} salt
   * @returns {Promise<{ valid: boolean, firstBrokenIndex: number|null, count: number }>}
   */
  async verifyChain(salt) {
    const events = await AuditEventModel.find().sort({ recordedAt: 1, _id: 1 }).lean();

    let expectedPrev = "";
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const recomputed = computeEventHash({
        prevHash: expectedPrev,
        action: event.action,
        actorUserId: event.actor?.userId?.toString?.() ?? "",
        subjectId: event.subject?.id ?? "",
        outcome: event.outcome,
        recordedAt: new Date(event.recordedAt).toISOString(),
        salt,
      });
      if (event.hash !== recomputed || event.prevHash !== expectedPrev) {
        return { valid: false, firstBrokenIndex: i, count: events.length };
      }
      expectedPrev = event.hash;
    }
    return { valid: true, firstBrokenIndex: null, count: events.length };
  }

  /**
   * Finds a single event by id.
   *
   * @param {string} id
   */
  async findById(id) {
    return AuditEventModel.findById(id).lean();
  }

  /**
   * Queries events with filters + pagination (design §5.2).
   *
   * @param {object} filters
   * @param {Date} [filters.from]
   * @param {Date} [filters.to]
   * @param {string} [filters.actorId]
   * @param {string} [filters.action]
   * @param {string} [filters.module]  derived from action prefix
   * @param {string} [filters.subjectType]
   * @param {string} [filters.outcome]
   * @param {string} [filters.correlationId]
   * @param {number} filters.page 1-based
   * @param {number} filters.pageSize
   * @param {object} [scope] optional actor-scope restriction
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async query({ from, to, actorId, action, module, subjectType, outcome, correlationId, page = 1, pageSize = 20 }, scope = {}) {
    const filter = {};

    if (from || to) {
      filter.recordedAt = {};
      if (from) filter.recordedAt.$gte = new Date(from);
      if (to) filter.recordedAt.$lte = new Date(to);
    }
    if (actorId) filter["actor.userId"] = actorId;
    if (action) filter.action = action;
    if (module) filter.action = { $regex: `^${escapeRegex(module)}.` };
    if (subjectType) filter["subject.type"] = subjectType;
    if (outcome) filter.outcome = outcome;
    if (correlationId) filter.correlationId = correlationId;

    // Scope restriction: e.g. HR admin sees only their own actions.
    if (scope.actorId) filter["actor.userId"] = scope.actorId;

    const [items, total] = await Promise.all([
      AuditEventModel.find(filter)
        .sort({ recordedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AuditEventModel.countDocuments(filter),
    ]);

    return { items, total };
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { AuditEventRepository };
