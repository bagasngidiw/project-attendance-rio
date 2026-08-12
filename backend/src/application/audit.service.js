/**
 * AuditService — application-level facade over the capture pipeline
 * (FR-012 / FR-013).
 *
 * Recording flows through the AuditEventPublisher (single pipeline with
 * outbox). Querying, chain verification, and export read from the append-only
 * collections. This is the contract consumed by the audit/activity consoles.
 */

class AuditService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/audit-publisher').AuditEventPublisher} deps.publisher
   * @param {import('../infrastructure/repositories/audit-event.repository').AuditEventRepository} deps.auditRepository
   * @param {import('../infrastructure/repositories/activity.repository').ActivityLogRepository} deps.activityRepository
   * @param {import('../infrastructure/hash-chain-verifier').HashChainVerifier} deps.chainVerifier
   */
  constructor({ publisher, auditRepository, activityRepository, chainVerifier }) {
    this.publisher = publisher;
    this.auditRepository = auditRepository;
    this.activityRepository = activityRepository;
    this.chainVerifier = chainVerifier;
  }

  /**
   * Records an event through the capture pipeline.
   * See AuditEventPublisher.publish for the accepted shape.
   */
  async record(event) {
    await this.publisher.publish(event);
  }

  /**
   * Paginated, filtered audit events (FR-012).
   * @param {object} filters see AuditEventRepository.query
   * @param {{ actorId?: string }} scope optional actor restriction
   */
  async queryAuditEvents(filters, scope = {}) {
    return this.auditRepository.query(filters, scope);
  }

  /**
   * Paginated, filtered activity records (FR-013).
   * @param {object} filters see ActivityLogRepository.query
   * @param {{ actorId?: string }} scope optional actor restriction
   */
  async queryActivityRecords(filters, scope = {}) {
    return this.activityRepository.query(filters, scope);
  }

  /**
   * Finds a single audit event by id.
   */
  async getAuditEvent(id) {
    return this.auditRepository.findById(id);
  }

  /**
   * Verifies the hash chain (tamper-evidence report).
   */
  async verifyChain() {
    return this.chainVerifier.verify();
  }

  /**
   * Exports filtered audit events as CSV (design §5.1 POST /audit/export;
   * follows FR-018 export governance — caller records the export action).
   *
   * @param {object} filters query filters (no pagination — full result set)
   * @param {{ actorId?: string }} scope
   * @returns {Promise<string>} CSV payload
   */
  async exportAuditEvents(filters, scope = {}) {
    const { items } = await this.auditRepository.query(
      { ...filters, page: 1, pageSize: 10000 },
      scope
    );
    return toCsv(items, AUDIT_EVENTS_COLUMNS);
  }
}

const AUDIT_EVENTS_COLUMNS = Object.freeze([
  "recordedAt",
  "action",
  "category",
  "outcome",
  "actor.userId",
  "subject.type",
  "subject.id",
  "subject.summary",
  "correlationId",
  "ip",
]);

function toCsv(items, columns) {
  const header = columns.join(",");
  const rows = items.map((item) =>
    columns
      .map((col) => {
        const value = col.split(".").reduce((acc, key) => acc?.[key], item);
        return csvCell(value);
      })
      .join(",")
  );
  return [header, ...rows].join("\n");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

module.exports = { AuditService };
