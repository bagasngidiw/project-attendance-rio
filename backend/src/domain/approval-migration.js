/**
 * Approval migration helpers (FR-012).
 *
 * Additive mapping from LEGACY request documents to the FR-002 embedded
 * `approval` structure. Rules (agents.md §32):
 *   - never fabricate historical approvers (approvedBy stays null when unknown)
 *   - derive status only when unambiguous (PENDING → PENDING_APPROVAL)
 *   - never delete or overwrite existing data
 *
 * Pure: takes a plain legacy document and returns the fields to $set.
 */

const LEGACY_STATUS_TO_APPROVAL = Object.freeze({
  PENDING: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

/**
 * Derives the embedded approval subdocument for a legacy request doc.
 *
 * @param {object} doc legacy request document
 * @returns {object|null} the approval fields to persist, or null when the doc
 *   already carries an `approval` field (idempotent)
 */
function deriveApprovalFromLegacy(doc) {
  if (doc.approval && typeof doc.approval === "object") {
    return null; // already migrated
  }

  const decision = doc.decision ?? null;
  const status = LEGACY_STATUS_TO_APPROVAL[doc.status] ?? null;

  const approval = {
    targetType: null,
    targetRoleId: null,
    targetUserId: null,
    assignedUserId: doc.approverId ? String(doc.approverId) : null,
    assignedAt: doc.submittedAt ? doc.submittedAt : null,
    status,
    approvedBy: decision?.action === "APPROVED" ? String(decision.actorId ?? "") || null : null,
    approvedAt: decision?.action === "APPROVED" ? decision.decidedAt ?? null : null,
    rejectedBy: decision?.action === "REJECTED" ? String(decision.actorId ?? "") || null : null,
    rejectedAt: decision?.action === "REJECTED" ? decision.decidedAt ?? null : null,
    rejectionReason:
      decision?.action === "REJECTED" ? decision.comment ?? null : null,
    configurationSnapshot: null,
  };

  // Never fabricate an approver: only keep ids that actually exist.
  if (approval.approvedBy === "null" || approval.approvedBy === "") approval.approvedBy = null;
  if (approval.rejectedBy === "null" || approval.rejectedBy === "") approval.rejectedBy = null;

  return approval;
}

module.exports = { deriveApprovalFromLegacy, LEGACY_STATUS_TO_APPROVAL };
