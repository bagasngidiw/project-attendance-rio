/**
 * AuditEventPublisher — the single capture pipeline for audit + activity
 * events (FR-012/FR-013, design §2/§4).
 *
 * Every module records through `publish(...)`; classification (audit,
 * activity, or both), secret scrubbing, correlation, and persistence are all
 * handled here so modules never write logging code themselves.
 *
 * Reliability: events are enqueued to the outbox first, then dispatched.
 * Dispatch failures mark the outbox entry FAILED (retryable) — logging never
 * blocks or fails core operations.
 */

const {
  classifyEvent,
  scrubMetadata,
} = require("../domain/audit");

class AuditEventPublisher {
  /**
   * @param {object} deps
   * @param {import('./repositories/outbox.repository').OutboxRepository} deps.outboxRepository
   * @param {import('./repositories/audit-event.repository').AuditEventRepository} deps.auditRepository
   * @param {import('./repositories/activity.repository').ActivityLogRepository} deps.activityRepository
   * @param {string} deps.chainSalt server-side hash-chain salt
   * @param {object} [deps.logger]
   */
  constructor({ outboxRepository, auditRepository, activityRepository, chainSalt, logger = console }) {
    this.outboxRepository = outboxRepository;
    this.auditRepository = auditRepository;
    this.activityRepository = activityRepository;
    this.chainSalt = chainSalt;
    this.logger = logger;
  }

  /**
   * Publishes an event to the appropriate surface(s).
   *
   * @param {object} event
   * @param {string} event.action registered event action
   * @param {{ userId: string, roleKeys?: string[], scope?: string }} [event.actor]
   * @param {{ type: string, id?: string, summary?: string }} [event.subject]
   * @param {'SUCCESS'|'FAILURE'|'DENIED'} [event.outcome]
   * @param {object} [event.metadata]
   * @param {string} [event.correlationId]
   * @param {string} [event.ip]
   * @param {string} [event.userAgent]
   */
  async publish(event) {
    const { audit, activity } = classifyEvent(event.action);
    const payload = {
      action: event.action,
      actor: event.actor ?? null,
      subject: event.subject ?? null,
      outcome: event.outcome ?? "SUCCESS",
      metadata: scrubMetadata(event.metadata ?? {}),
      correlationId: event.correlationId ?? "",
      ip: event.ip ?? "",
      userAgent: event.userAgent ?? "",
      // Classification is resolved at dispatch time so retries are stable.
      _audit: audit,
      _activity: activity,
    };

    await this.outboxRepository.enqueue(event.action, payload);
    await this.dispatchPending();
  }

  /**
   * Drains PENDING outbox entries into their target collections. Best-effort:
   * a failed entry is marked FAILED and left for the next retry cycle.
   */
  async dispatchPending() {
    const pending = await this.outboxRepository.claimPending(100);
    for (const entry of pending) {
      try {
        await this.write(entry.payload);
        await this.outboxRepository.markPublished(entry._id);
      } catch (err) {
        this.logger.error("[audit-publisher] dispatch failed", {
          eventType: entry.eventType,
          error: err.message,
        });
        await this.outboxRepository.markFailed(entry._id, err.message);
      }
    }
  }

  async write(payload) {
    if (payload._audit) {
      await this.auditRepository.append(payload, this.chainSalt);
    }
    if (payload._activity) {
      await this.activityRepository.insert(payload);
    }
  }
}

module.exports = { AuditEventPublisher };
