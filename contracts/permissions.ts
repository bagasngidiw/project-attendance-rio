/**
 * Permission keys — typed contract shared by frontend and future TS consumers.
 *
 * MIRROR of backend `src/domain/permissions.js`. Keep both in sync: any key
 * added here must be registered in the backend registry and seeded.
 */

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",

  PROFILE_VIEW: "profile:view",
  PROFILE_UPDATE: "profile:update",

  ATTENDANCE_CLOCK_IN: "attendance:clock_in",
  ATTENDANCE_CLOCK_OUT: "attendance:clock_out",
  ATTENDANCE_VIEW_OWN: "attendance:view_own",
  ATTENDANCE_VIEW_ALL: "attendance:view_all",
  ATTENDANCE_CORRECT: "attendance:correct",
  ATTENDANCE_REVIEW_EXCEPTIONS: "attendance:review_exceptions",

  OVERTIME_SUBMIT: "overtime:submit",
  OVERTIME_VIEW_OWN: "overtime:view_own",
  OVERTIME_VIEW_ALL: "overtime:view_all",
  OVERTIME_REVIEW: "overtime:review",
  OVERTIME_APPROVE: "overtime:approve",
  OVERTIME_MANAGE: "overtime:manage",

  TRIP_SUBMIT: "trip:submit",
  TRIP_VIEW_OWN: "trip:view_own",
  TRIP_VIEW_ALL: "trip:view_all",
  TRIP_REVIEW: "trip:review",
  TRIP_APPROVE: "trip:approve",

  LEAVE_SUBMIT: "leave:submit",
  LEAVE_VIEW_OWN: "leave:view_own",
  LEAVE_VIEW_ALL: "leave:view_all",
  LEAVE_REVIEW: "leave:review",
  LEAVE_APPROVE: "leave:approve",
  LEAVE_VIEW_BALANCES: "leave:view_balances",
  LEAVE_MANAGE_BALANCES: "leave:manage_balances",

  USERS_VIEW: "users:view",
  USERS_CREATE: "users:create",
  USERS_EDIT: "users:edit",
  USERS_DEACTIVATE: "users:deactivate",
  USERS_RESET_PASSWORD: "users:reset_password",
  USERS_ASSIGN_ROLES: "users:assign_roles",
  USERS_IMPORT: "users:import",

  FILES_UPLOAD: "files:upload",
  FILES_DOWNLOAD: "files:download",
  FILES_DELETE: "files:delete",

  CALENDAR_MANAGE_HOLIDAYS: "calendar:manage_holidays",

  COMPLIANCE_MANAGE_RETENTION: "compliance:manage_retention",
  COMPLIANCE_EXPORT_PERSONAL_DATA: "compliance:export_personal_data",

  ORG_MANAGE_DEPARTMENTS: "org:manage_departments",
  ORG_MANAGE_POSITIONS: "org:manage_positions",

  REPORTING_VIEW: "reporting:view",
  REPORTING_EXPORT_EXCEL: "reporting:export_excel",
  REPORTING_EXPORT_PDF: "reporting:export_pdf",
  REPORTING_DRILL_DOWN: "reporting:drill_down",
  REPORTING_VIEW_ALL_STATUSES: "reporting:view_all_statuses",

  RBAC_VIEW_ROLES: "rbac:view_roles",
  RBAC_VIEW_PERMISSIONS: "rbac:view_permissions",
  RBAC_MANAGE_ROLES: "rbac:manage_roles",
  RBAC_MANAGE_PERMISSIONS: "rbac:manage_permissions",

  AUDIT_VIEW: "audit:view",

  TEAM_VIEW_TEAM: "team:view_team",
  TEAM_VIEW_PENDING: "team:view_pending",
  DELEGATION_MANAGE: "delegation:manage",
  APPROVAL_DELEGATE: "approval:delegate",

  PLATFORM_SETTINGS: "platform:settings",
  PLATFORM_MODULES: "platform:modules",
  OVERRIDE_CUTOFF: "platform:override_cutoff",

  APPROVAL_CONFIG_MANAGE: "approval_config:manage",

  PERMISSION_SUBMIT: "permission:submit",
  PERMISSION_VIEW_OWN: "permission:view_own",
  PERMISSION_VIEW_ALL: "permission:view_all",
  PERMISSION_REVIEW: "permission:review",
  PERMISSION_APPROVE: "permission:approve",

  SAKIT_SUBMIT: "sakit:submit",
  SAKIT_VIEW_OWN: "sakit:view_own",
  SAKIT_VIEW_ALL: "sakit:view_all",
  SAKIT_REVIEW: "sakit:review",
  SAKIT_APPROVE: "sakit:approve",

  MFA_MANAGE: "mfa:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Every registered permission as a flat array (for tooling/seed). */
export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(
  PERMISSIONS
);
