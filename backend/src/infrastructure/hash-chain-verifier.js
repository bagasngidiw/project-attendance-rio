/**
 * HashChainVerifier — verifies the integrity of the audit hash chain
 * (FR-012 §4.1 / §8). Recomputed hashes must match stored hashes and each
 * event's `prevHash` must equal the previous event's hash. Any mismatch
 * indicates tampering.
 */

const { computeEventHash } = require("../domain/audit");

class HashChainVerifier {
  /**
   * @param {import('./repositories/audit-event.repository').AuditEventRepository} auditRepository
   * @param {string} salt
   */
  constructor({ auditRepository, salt }) {
    this.auditRepository = auditRepository;
    this.salt = salt;
  }

  /**
   * Verifies the chain and returns a report.
   * @returns {Promise<{ valid: boolean, firstBrokenIndex: number|null, count: number }>}
   */
  async verify() {
    return this.auditRepository.verifyChain(this.salt);
  }

  /**
   * Verifies a single event's hash against its recorded inputs (useful for
   * point-in-time spot checks).
   */
  verifyEventHash(event) {
    const recomputed = computeEventHash({
      prevHash: event.prevHash,
      action: event.action,
      actorUserId: event.actor?.userId?.toString?.() ?? "",
      subjectId: event.subject?.id ?? "",
      outcome: event.outcome,
      recordedAt: new Date(event.recordedAt).toISOString(),
      salt: this.salt,
    });
    return recomputed === event.hash;
  }
}

module.exports = { HashChainVerifier };
