/**
 * Dashboard domain model (FR-025 / FR-026).
 *
 * Declarative widget contract: each dashboard widget declares the permission
 * keys that grant it (ANY match). The backend filters the data the DTO
 * carries by the caller's permissions; the frontend renders widgets from the
 * same keys. Quick actions are derived from the caller's effective
 * permissions so the surface never shows an action the user cannot perform.
 */

const { hasPermission } = require("./permissions");

/** Widget definitions shared conceptually with the frontend contract. */
const DASHBOARD_WIDGETS = Object.freeze([
  { id: "attendanceStatus", title: "Today", permission: ["attendance:clock_in", "attendance:view_own"] },
  { id: "requestSummary", title: "Requests", permission: ["leave:view_own", "overtime:view_own", "trip:view_own"] },
  { id: "recentRequests", title: "Recent requests", permission: ["leave:view_own", "overtime:view_own", "trip:view_own"] },
  { id: "quickActions", title: "Quick actions", permission: ["attendance:clock_in", "leave:submit", "overtime:submit", "trip:submit"] },
  { id: "workforce", title: "Workforce", permission: ["users:view"] },
  { id: "attendanceSummary", title: "Attendance", permission: ["attendance:view_all"] },
  { id: "pendingRequests", title: "Pending requests", permission: ["leave:review", "overtime:review", "trip:review"] },
  { id: "recentApprovals", title: "Recent approvals", permission: ["leave:approve", "overtime:approve", "trip:approve"] },
]);

/** Quick-action candidates: permission key → surfaced action key. */
const QUICK_ACTIONS = Object.freeze([
  { key: "attendance:clock_in", permission: "attendance:clock_in" },
  { key: "attendance:clock_out", permission: "attendance:clock_out" },
  { key: "leave:submit", permission: "leave:submit" },
  { key: "overtime:submit", permission: "overtime:submit" },
  { key: "trip:submit", permission: "trip:submit" },
]);

/**
 * Derives the quick actions a user may perform from their effective
 * permissions (FR-025 §5.1 / FR-003/004).
 *
 * @param {readonly string[]} permissions
 * @returns {string[]} permission keys the user can act on
 */
function computeQuickActions(permissions) {
  return QUICK_ACTIONS.filter((action) =>
    hasPermission(permissions, action.permission)
  ).map((action) => action.key);
}

/** True when the caller holds any of the HR-scope permissions. */
function hasHrScope(permissions) {
  return (
    hasPermission(permissions, "attendance:view_all") ||
    hasPermission(permissions, "reporting:view")
  );
}

module.exports = {
  DASHBOARD_WIDGETS,
  QUICK_ACTIONS,
  computeQuickActions,
  hasHrScope,
};
