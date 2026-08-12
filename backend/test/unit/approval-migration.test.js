/**
 * FR-012 migration tests: legacy request docs map to the embedded approval
 * structure additively; historical approvers are never fabricated; already
 * migrated docs are skipped.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { deriveApprovalFromLegacy } = require("../../src/domain/approval-migration");

test("maps a legacy PENDING doc to PENDING_APPROVAL with the assigned approver", () => {
  const approval = deriveApprovalFromLegacy({
    status: "PENDING",
    approverId: "u_mgr",
    submittedAt: new Date("2026-08-07T10:00:00Z"),
    decision: null,
  });
  assert.equal(approval.status, "PENDING_APPROVAL");
  assert.equal(approval.assignedUserId, "u_mgr");
  assert.equal(approval.approvedBy, null);
  assert.equal(approval.rejectedBy, null);
  assert.equal(approval.configurationSnapshot, null);
});

test("derives the real approver from an APPROVED decision", () => {
  const approval = deriveApprovalFromLegacy({
    status: "APPROVED",
    approverId: "u_mgr",
    decision: { action: "APPROVED", actorId: "u_mgr", comment: "ok", decidedAt: new Date("2026-08-08T09:00:00Z") },
  });
  assert.equal(approval.status, "APPROVED");
  assert.equal(approval.approvedBy, "u_mgr");
  assert.equal(approval.approvedAt.toISOString(), new Date("2026-08-08T09:00:00Z").toISOString());
});

test("derives rejection reason from a REJECTED decision", () => {
  const approval = deriveApprovalFromLegacy({
    status: "REJECTED",
    decision: { action: "REJECTED", actorId: "u_mgr", comment: "Tidak cukup kuota", decidedAt: new Date() },
  });
  assert.equal(approval.status, "REJECTED");
  assert.equal(approval.rejectedBy, "u_mgr");
  assert.equal(approval.rejectionReason, "Tidak cukup kuota");
});

test("never fabricates an approver when the decision has no actor", () => {
  const approval = deriveApprovalFromLegacy({
    status: "APPROVED",
    decision: { action: "APPROVED", actorId: null, comment: "", decidedAt: new Date() },
  });
  assert.equal(approval.approvedBy, null);
});

test("skips documents that already carry the approval structure (idempotent)", () => {
  const result = deriveApprovalFromLegacy({
    status: "PENDING",
    approval: { targetType: "USER", assignedUserId: "u_x" },
  });
  assert.equal(result, null);
});

test("keeps cancellation status without inventing a decision", () => {
  const approval = deriveApprovalFromLegacy({ status: "CANCELLED", decision: null });
  assert.equal(approval.status, "CANCELLED");
  assert.equal(approval.approvedBy, null);
  assert.equal(approval.rejectedBy, null);
});
