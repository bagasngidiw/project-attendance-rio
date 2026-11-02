/**
 * Approval access policy — company-wide approval visibility and decision
 * override capability.
 *
 * Authorization is layered (agents.md §22): holding a request-type approve
 * permission allows acting on an assigned request. Company-wide inbox
 * visibility and decision override require an explicit capability so module
 * `*:view_all` permissions do not turn every manager into an all-request
 * approver:
 *
 *   - the SUPER_ADMIN system role (bootstrap compatibility), OR
 *   - the wildcard permission "*", OR
 *   - the explicit `approval:override` permission.
 *
 * Historical read visibility is intentionally broader: holders of any module
 * `*:view_all` permission may read the decided-request history, but they do
 * not gain the pending approval queue.
 */

const { hasPermission } = require("./permissions");

const SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";
const OVERRIDE_PERMISSION = "approval:override";
const REQUEST_TYPE_KEYS = ["leave", "trip", "overtime", "permission", "sakit"];

function normalizeRoleKeys(actor = {}) {
  return (actor.actorRoleKeys ?? []).map((key) => String(key).toUpperCase());
}

function effectivePermissions(actor = {}) {
  return actor.actorPermissions ?? [];
}

/** True when the actor carries the system SUPER_ADMIN role key. */
function isSuperAdmin(actor = {}) {
  return normalizeRoleKeys(actor).includes(SUPER_ADMIN_ROLE_KEY);
}

/**
 * True when the actor may see every pending request and override an
 * unassigned or foreign-assigned approval.
 */
function canOverrideApprovals(actor = {}) {
  return (
    isSuperAdmin(actor) ||
    hasPermission(effectivePermissions(actor), OVERRIDE_PERMISSION)
  );
}

/**
 * True when the actor may read the company-wide decision history. Module
 * `*:view_all` remains sufficient here (legacy reporting behavior), while the
 * pending queue is reserved for `canOverrideApprovals`.
 */
function canSeeAllApprovalHistory(actor = {}) {
  return (
    canOverrideApprovals(actor) ||
    REQUEST_TYPE_KEYS.some((type) =>
      hasPermission(effectivePermissions(actor), `${type}:view_all`)
    )
  );
}

module.exports = {
  OVERRIDE_PERMISSION,
  isSuperAdmin,
  canOverrideApprovals,
  canSeeAllApprovalHistory,
};
