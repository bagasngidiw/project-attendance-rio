import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

import type {
  ApiEnvelope,
  RefreshResponse,
  SignInResponse,
  SessionResponse,
  MeResponse,
} from "@contracts/auth";

import type {
  AuditEventsResponse,
  ActivityRecordsResponse,
  ChainVerifyResponse,
  AuditQueryParams,
} from "@contracts/audit";

import type {
  AdminRoleResponse,
  AdminRolesListResponse,
  MatrixResponseEnvelope,
  SetPermissionsRequest,
  SetPermissionsResponseEnvelope,
  ToggleRoleStatusEnvelope,
  ToggleRoleStatusRequest,
  UpdateRoleRequest,
  EffectivePermissionsEnvelope,
  CreateRoleRequest,
  RoleMetaEnvelope,
  ValidateRoleRequest,
  ValidateRoleEnvelope,
  RolePreviewEnvelope,
  RoleCopyEnvelope,
} from "@contracts/rbac-admin";

import type {
  TeamOverviewResponse,
  TeamMemberResponse,
} from "@contracts/team";

import type {
  RequestDetailResponse,
  RequestListResponse,
  RequestType,
} from "@contracts/requests";
import type {
  SicknessTypeListResponse,
  SicknessTypeResponse,
} from "@contracts/sickness";
import type {
  LeaveTypeListResponse,
  LeaveTypeResponse,
  CreateLeaveTypeInput,
  LeaveBalancesResponse,
} from "@contracts/leave";
import type {
  ApprovalConfigurationResponse,
  ApprovalConfigurationsResponse,
  ApprovalConfigurationUpdateBody,
  ApprovalDrillDownResponse,
  ApprovalRequestType,
  ApprovalTargetsResponse,
  ApprovalTargetType,
  ApprovalTargetValue,
  BlockedReasonResponse,
  DecisionAction,
  EscalateResponse,
  RequestHistoryResponse,
  RoutingRuleDto,
  RoutingRulesResponse,
  UnifiedApprovalParams,
} from "@contracts/approvals";
import type {
  AttendanceListResponse,
  AttendanceRecordResponse,
} from "@contracts/attendance";
import type {
  AttachmentListResponse,
  AttachmentUploadResponse,
} from "@contracts/attachments";
import type {
  ReportFilters,
  ReportPreviewResponse,
  ReportTypeKey,
  ReportTypesResponse,
} from "@contracts/reports";
import type {
  HrDashboardResponse,
  PersonalDashboardResponse,
} from "@contracts/dashboard";
import type { ProfileResponse, ProfileUpdateDto } from "@contracts/profile";
import type {
  OrgEntryResponse,
  OrgListResponse,
  ReportingHistoryResponse,
} from "@contracts/org";
import type {
  NotificationListResponse,
  NotificationPreferencesResponse,
  UnreadCountResponse,
} from "@contracts/notifications";

import type {
  BrandingLogoResponse,
  BrandingResponse,
  BrandingUpdateDto,
} from "@contracts/platform";

import {
  clearAuthStorage,
  getRefreshToken,
  setRefreshToken,
  setSessionId,
} from "./auth-storage";
import { toast } from "./toast";

/** Password policy shape returned by the platform settings surface (FR-044). */
export interface PasswordPolicyDto {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  maxLength: number;
  expiryDays: number;
  historyLength: number;
}

/** User admin DTO returned by the lifecycle endpoints (FR-029). */
export interface UserAdminDto {
  id: string;
  username: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  mustChangePassword: boolean;
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  roles: string[];
  // Relation model: role refs + human-readable names (never raw ObjectIds).
  roleIds: string[];
  departmentName?: string | null;
  positionName?: string | null;
  managerName?: string | null;
}

export interface UserListResult {
  items: UserAdminDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Optional production API base override. When VITE_API_URL is set at build
 * time (e.g. https://walk-sycamore-sublevel.ngrok-free.dev or a Render URL),
 * every API call targets that origin + "/api/v1". When unset the default
 * relative "/api/v1" is used, which relies on the Vercel rewrite / Vite dev
 * proxy. The ngrok URL is NEVER hardcoded in source — only via this env var.
 */
const configuredApiBase = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? ""
)
  .trim()
  .replace(/\/+$/, "");

/** API client with automatic access-token attachment and refresh-on-401. */
export const api: AxiosInstance = axios.create({
  baseURL: configuredApiBase ? `${configuredApiBase}/api/v1` : "/api/v1",
  headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true", },
});

/**
 * Fetches a relative /api asset path through the shared axios instance (which
 * carries the ngrok-skip-browser-warning header) and returns an object URL for
 * inline <img>/<a> rendering. Raw browser <img src> requests cannot send that
 * header, which is why assets proxied to ngrok must be loaded as blobs.
 * Callers MUST revoke the returned object URL when it is replaced or unmounted.
 */
export async function fetchBlobObjectUrl(relativePath: string): Promise<string> {
  const res = await api.get(relativePath, { responseType: "blob" });
  return URL.createObjectURL(res.data as Blob);
}

/** In-memory access token (never persisted). */
let accessToken: string | null = null;

/** Guards against concurrent refresh storms from parallel 401s. */
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Callbacks invoked when a session can no longer be restored. */
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: () => void): void {
  onSessionExpired = handler;
}

function notifySessionExpired(): void {
  clearAuthStorage();
  setAccessToken(null);
  onSessionExpired?.();
}

// Attach the bearer token to every outgoing request.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Attempts a single refresh-and-retry when an authenticated request returns
 * 401 (design §6.2). On failure, purges auth state and redirects to login.
 */
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<never>>) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // A 403 on a protected action means the user lacks the permission
    // (FR-005). Surface a friendly denial — the server already audit-logged it.
    if (error.response?.status === 403) {
      if (original && !original.url?.includes("/auth/signin")) {
        toast.denied();
      }
      return Promise.reject(error);
    }

    if (
      !original ||
      original._retry ||
      error.response?.status !== 401 ||
      original.url?.includes("/auth/signin") ||
      original.url?.includes("/auth/refresh")
    ) {
      if (error.response?.status === 401 && !original?._retry) {
        // Session endpoints returning 401 mean the current session is dead.
        if (
          original?.url?.includes("/auth/session") ||
          original?.url?.includes("/users/me")
        ) {
          notifySessionExpired();
        }
      }
      return Promise.reject(error);
    }

    original._retry = true;
    const newToken = await refreshAccessToken();
    if (!newToken) {
      notifySessionExpired();
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return api(original);
  }
);

/** Refreshes the access token using the stored refresh token (single-flight). */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const { data } = await axios.post<ApiEnvelope<RefreshResponse>>(
        "/api/v1/auth/refresh",
        { refreshToken }
      );
      if (!data.data) return null;

      accessToken = data.data.accessToken;
      setRefreshToken(data.data.refreshToken);
      setSessionId(data.data.sessionId);
      return data.data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const authApi = {
  signIn: (username: string, password: string) =>
    api.post<ApiEnvelope<SignInResponse>>("/auth/signin", {
      username,
      password,
    }),

  signOut: (refreshToken: string) =>
    api.post<ApiEnvelope<never>>("/auth/signout", { refreshToken }),

  signOutAll: () => api.post<ApiEnvelope<{ revokedSessions: number }>>("/auth/signout-all"),

  getSession: () => api.get<ApiEnvelope<SessionResponse>>("/auth/session"),

  me: () => api.get<ApiEnvelope<MeResponse>>("/users/me"),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<ApiEnvelope<{ success: true }>>("/auth/change-password", {
      currentPassword,
      newPassword,
    }),
};

/** User lifecycle admin API (FR-029/FR-028). */
export const usersApi = {
  list: (params: Record<string, unknown>) =>
    api.get<ApiEnvelope<UserListResult>>("/users", { params }),
  get: (id: string) => api.get<ApiEnvelope<UserAdminDto>>(`/users/${id}`),
  create: (body: {
    username: string;
    email: string;
    name: string;
    departmentId?: string | null;
    positionId?: string | null;
    managerId?: string | null;
    roleIds: string[];
    initialPassword: string;
    // TODO.md FR-001: allocated leave quota (hari) for balance-based types.
    jatahCuti?: number;
  }) => api.post<ApiEnvelope<UserAdminDto>>("/users", body),
  update: (
    id: string,
    body: {
      name?: string;
      email?: string;
      departmentId?: string | null;
      positionId?: string | null;
      managerId?: string | null;
      // TODO.md FR-002: quota change + mandatory reason.
      jatahCuti?: number;
      reason?: string;
    }
  ) => api.put<ApiEnvelope<UserAdminDto>>(`/users/${id}`, body),
  deactivate: (id: string) =>
    api.post<ApiEnvelope<UserAdminDto>>(`/users/${id}/deactivate`),
  activate: (id: string) =>
    api.post<ApiEnvelope<UserAdminDto>>(`/users/${id}/activate`),
  resetPassword: (id: string, initialPassword: string) =>
    api.post<ApiEnvelope<{ userId: string; mustChangePassword: true }>>(
      `/users/${id}/reset-password`,
      { initialPassword }
    ),
  /** TODO.md FR-011: employee work schedule (days + hours). */
  updateWorkSchedule: (
    id: string,
    body: {
      workingDays: number[];
      workingStartTime: string;
      workingEndTime: string;
    }
  ) => api.put<ApiEnvelope<UserAdminDto>>(`/users/${id}/work-schedule`, body),
};

/** Platform settings API (FR-044 password policy). */
export const passwordPolicyApi = {
  get: () => api.get<ApiEnvelope<PasswordPolicyDto>>("/platform/settings/password-policy"),
  update: (policy: PasswordPolicyDto) =>
    api.put<ApiEnvelope<PasswordPolicyDto>>("/platform/settings/password-policy", policy),
};

/**
 * Platform branding API (FR-001 / FR-004) — identity + colors + logo.
 * `public()` is the unauthenticated runtime-theme endpoint consumed by the
 * anti-flash bootstrap; the rest are guarded by `platform:settings`.
 */
export const brandingApi = {
  /** Public runtime theme (no auth) — identity + semantic tokens. */
  public: () => api.get<BrandingResponse>("/platform/branding"),

  /** Current branding for the settings surface (requires platform:settings). */
  get: () => api.get<BrandingResponse>("/platform/settings/branding"),

  /** Persist identity + colors (+ optional committed logo reference). */
  update: (body: BrandingUpdateDto) =>
    api.put<BrandingResponse>("/platform/settings/branding", body),

  /** Stage a logo asset (multipart field "file"; PNG/JPG/SVG, max 2MB). */
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<BrandingLogoResponse>("/platform/settings/branding/logo", formData, {
      headers: { "Content-Type": false },
    });
  },

  /** Remove the persisted logo asset. */
  removeLogo: () =>
    api.delete<BrandingLogoResponse>("/platform/settings/branding/logo"),
};

export const auditApi = {
  listEvents: (params: AuditQueryParams) =>
    api.get<AuditEventsResponse>("/audit/events", { params }),

  listActivity: (params: AuditQueryParams) =>
    api.get<ActivityRecordsResponse>("/activity/records", { params }),

  verifyChain: () => api.get<ChainVerifyResponse>("/audit/verify"),

  /** Downloads the filtered audit events as CSV. */
  exportEvents: (params: AuditQueryParams) =>
    api.get("/audit/export", { params, responseType: "blob" }),
};

export const rbacAdminApi = {
  getMatrix: () => api.get<MatrixResponseEnvelope>("/rbac/admin/matrix"),

  listRoles: () => api.get<AdminRolesListResponse>("/rbac/roles"),

  getRole: (id: string) => api.get<AdminRoleResponse>(`/rbac/admin/roles/${id}`),

  createRole: (body: CreateRoleRequest) =>
    api.post<AdminRoleResponse>("/rbac/admin/roles", body),

  updateRole: (id: string, body: UpdateRoleRequest) =>
    api.put<AdminRoleResponse>(`/rbac/admin/roles/${id}`, body),

  setPermissions: (id: string, body: SetPermissionsRequest) =>
    api.patch<SetPermissionsResponseEnvelope>(`/rbac/admin/roles/${id}/permissions`, body),

  disableRole: (id: string, body: ToggleRoleStatusRequest) =>
    api.post<ToggleRoleStatusEnvelope>(`/rbac/admin/roles/${id}/disable`, body),

  enableRole: (id: string, body: ToggleRoleStatusRequest) =>
    api.post<ToggleRoleStatusEnvelope>(`/rbac/admin/roles/${id}/enable`, body),

  getEffectivePermissions: (userId: string) =>
    api.get<EffectivePermissionsEnvelope>(
      `/rbac/admin/users/${userId}/effective-permissions`
    ),

  /** FR-064: role wizard metadata (checklist groups, templates, deps, level schema). */
  getMeta: () => api.get<RoleMetaEnvelope>("/rbac/admin/meta"),

  /** FR-064: validate a prospective role before save (no persistence). */
  validateRole: (body: ValidateRoleRequest) =>
    api.post<ValidateRoleEnvelope>("/rbac/admin/roles/validate", body),

  /** FR-064: effective-access preview for an existing role. */
  previewRole: (id: string) =>
    api.get<RolePreviewEnvelope>(`/rbac/admin/roles/${id}/preview`),

  /** FR-064: copy an existing role into an editable draft. */
  copyRole: (sourceId: string) =>
    api.get<RoleCopyEnvelope>(`/rbac/admin/roles/copy/${sourceId}`),
};

/** Manager team overview API (FR-006). */
export const managerTeamApi = {
  getTeamOverview: () => api.get<TeamOverviewResponse>("/manager/team"),
  getTeamMember: (memberId: string) =>
    api.get<TeamMemberResponse>(`/manager/team/${memberId}`),
};

/** Request lifecycle API (FR-016 / FR-036 / FR-054). */
export const requestApi = {
  mine: (params: Record<string, unknown>) =>
    api.get<RequestListResponse>("/requests/mine", { params }),

  get: (id: string) => api.get<RequestDetailResponse>(`/requests/${id}`),

  cancel: (id: string, reason: string) =>
    api.post<RequestDetailResponse>(`/requests/${id}/cancel`, { reason }),

  submitLeave: (body: {
    leaveType: string;
    leaveTypeName?: string;
    startDate: string;
    endDate: string;
    reason: string;
    approvalTarget?: ApprovalTargetValue;
  }) => api.post<RequestDetailResponse>("/leave/requests", body),

  submitOvertime: (body: {
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    approvalTarget?: ApprovalTargetValue;
  }) => api.post<RequestDetailResponse>("/overtime/requests", body),

  submitTrip: (body: {
    destination: string;
    startDate: string;
    endDate: string;
    purpose: string;
    approvalTarget?: ApprovalTargetValue;
  }) => api.post<RequestDetailResponse>("/trip/requests", body),

  /** Sickness (Sakit) module — a distinct request type from Leave/Cuti. */
  submitSakit: (body: {
    sicknessType: string;
    sicknessTypeName?: string;
    startDate: string;
    endDate?: string;
    reason: string;
    approvalTarget?: ApprovalTargetValue;
  }) => api.post<RequestDetailResponse>("/sakit/requests", body),

  /** FR-002: atomically claim a role-targeted request. */
  claim: (id: string) => api.post<RequestDetailResponse>(`/requests/${id}/claim`),

  /** FR-002: approve the assigned request. */
  approve: (id: string) => api.post<RequestDetailResponse>(`/requests/${id}/approve`),

  /** FR-002: reject with a mandatory reason. */
  reject: (id: string, reason: string) =>
    api.post<RequestDetailResponse>(`/requests/${id}/reject`, { reason }),

  /** FR-002: append-only approval timeline (request + events). */
  approvalHistory: (id: string) =>
    api.get<RequestHistoryResponse>(`/requests/${id}/approval-history`),
};

/** Permission / Ijin request API (FR-007). */
export const permissionApi = {
  submit: (body: {
    date?: string;
    startDate?: string;
    endDate?: string;
    reason: string;
    approvalTarget?: ApprovalTargetValue;
  }) => api.post<RequestDetailResponse>("/permission/requests", body),
};

/** Sickness-type master data API (active list + "Tambahkan sendiri" suggestion). */
export const sicknessTypeApi = {
  list: () => api.get<SicknessTypeListResponse>("/sickness-types"),
  suggest: (body: { name: string; description?: string }) =>
    api.post<SicknessTypeResponse>("/sickness-types/suggest", body),
};

/** Leave-type user-facing API: active list + "Tambahkan sendiri" suggestion. */
export const leaveTypeApi = {
  listActive: () => api.get<LeaveTypeListResponse>("/leave/types"),
  suggest: (body: { name: string; description?: string }) =>
    api.post<LeaveTypeResponse>("/leave/types/suggest", body),
};

/** TODO.md FR-004/FR-007: leave balances; self by default, target via userId (HR). */
export const leaveBalanceApi = {
  listByUser: (userId?: string, year?: number) =>
    api.get<LeaveBalancesResponse>("/leave/balances", {
      params: { userId: userId ?? undefined, year: year ?? undefined },
    }),
};

/** Superadmin master-data API: leave types (guarded by platform:settings). */
export const leaveTypeAdminApi = {
  list: () => api.get<LeaveTypeListResponse>("/admin/leave-types"),
  create: (body: CreateLeaveTypeInput) =>
    api.post<LeaveTypeResponse>("/admin/leave-types", body),
  update: (id: string, body: Partial<CreateLeaveTypeInput>) =>
    api.put<LeaveTypeResponse>(`/admin/leave-types/${id}`, body),
  activate: (id: string) =>
    api.post<LeaveTypeResponse>(`/admin/leave-types/${id}/activate`),
  deactivate: (id: string) =>
    api.post<LeaveTypeResponse>(`/admin/leave-types/${id}/deactivate`),
};

/** Superadmin master-data API: sickness types (guarded by platform:settings). */
export const sicknessTypeAdminApi = {
  list: () => api.get<SicknessTypeListResponse>("/admin/sickness-types"),
  create: (body: { key: string; name: string; description?: string }) =>
    api.post<SicknessTypeResponse>("/admin/sickness-types", body),
  update: (id: string, body: { name?: string; description?: string }) =>
    api.put<SicknessTypeResponse>(`/admin/sickness-types/${id}`, body),
  activate: (id: string) =>
    api.post<SicknessTypeResponse>(`/admin/sickness-types/${id}/activate`),
  deactivate: (id: string) =>
    api.post<SicknessTypeResponse>(`/admin/sickness-types/${id}/deactivate`),
};

/** FR-001: Superadmin approval configuration API. */
export const approvalConfigApi = {
  list: () => api.get<ApprovalConfigurationsResponse>("/approval-configurations"),
  get: (requestType: ApprovalRequestType) =>
    api.get<ApprovalConfigurationResponse>(`/approval-configurations/${requestType}`),
  update: (requestType: ApprovalRequestType, body: ApprovalConfigurationUpdateBody) =>
    api.put<ApprovalConfigurationResponse>(`/approval-configurations/${requestType}`, body),
};

/** FR-003: eligible approval targets (roles + users) for a request type. */
export const approvalTargetsApi = {
  list: (type: ApprovalTargetType, roleId?: string) =>
    api.get<ApprovalTargetsResponse>("/approval-targets", {
      params: { type, roleId: roleId ?? undefined },
    }),
};

/** FR-008: request attachment surface (upload/list/download/delete). */
export const attachmentApi = {
  /** Multipart upload of an optional supporting file (files:upload). */
  upload: (requestId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<AttachmentUploadResponse>(
      `/requests/${requestId}/attachments`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
  /** Metadata list for a request (files:download). */
  list: (requestId: string) =>
    api.get<AttachmentListResponse>(`/requests/${requestId}/attachments`),
  /** Authenticated download URL used for the file link (never anonymous). */
  downloadUrl: (id: string) => `/attachments/${id}/download`,
  /** Authenticated blob fetch for secure downloads (files:download). */
  download: async (id: string) => {
    const res = await api.get(`/attachments/${id}/download`, {
      responseType: "blob",
    });
    return res.data as Blob;
  },
  /** Soft-deletes an attachment (files:delete). */
  remove: (id: string) => api.delete(`/attachments/${id}`),
};

export type { RequestType };

/** Approval workflow API (FR-007 / FR-008 / FR-063). */
export const approvalApi = {
  inbox: (params: Record<string, unknown>) =>
    api.get<RequestListResponse>("/approvals/inbox", { params }),
  /** FR-063 unified approval surface (PENDING + scope filters). */
  unified: (params: UnifiedApprovalParams) =>
    api.get<RequestListResponse>("/approvals", { params }),
  history: (params: Record<string, unknown>) =>
    api.get<RequestListResponse>("/approvals/history", { params }),
  /** FR-063 drill-down: request payload + full history timeline. */
  drillDown: (id: string) =>
    api.get<ApprovalDrillDownResponse>(`/approvals/${id}`),
  /** FR-063 decide — rejection comment is optional; overrideCutoff bypasses blocks. */
  decide: (
    id: string,
    body: { decision: DecisionAction; comment?: string; overrideCutoff?: boolean }
  ) => api.post<RequestDetailResponse>(`/approvals/${id}/decide`, body),
  /** FR-063 escalate — requester or any approve holder; rate-limited (409). */
  escalate: (id: string, body: { message?: string }) =>
    api.post<EscalateResponse>(`/approvals/${id}/escalate`, body),
  /** FR-063 cutoff/calendar block reason before deciding. */
  blockedReason: (id: string) =>
    api.get<BlockedReasonResponse>(`/approvals/blocked-reason/${id}`),
  requestHistory: (id: string) =>
    api.get<RequestHistoryResponse>(`/requests/${id}/history`),
};

/** Routing configuration API (FR-042). */
export const routingAdminApi = {
  get: () => api.get<RoutingRulesResponse>("/admin/routing"),
  update: (rules: RoutingRuleDto[]) =>
    api.put<RoutingRulesResponse>("/admin/routing", { rules }),
};

/** Attendance API (FR-035 / FR-020 / FR-041). */
export const attendanceApi = {
  clockIn: (body?: { location?: unknown; camera?: unknown; device?: unknown }) =>
    api.post<AttendanceRecordResponse>("/attendance/clock-in", body ?? {}),
  clockOut: (body?: { location?: unknown; camera?: unknown; device?: unknown }) =>
    api.post<AttendanceRecordResponse>("/attendance/clock-out", body ?? {}),
  /** TODO.md FR-008: stage a captured selfie before clock-in. */
  uploadMedia: (file: File) => {
    const formData = new FormData();
    formData.append("selfie", file);
    return api.post<ApiEnvelope<{ mediaRef: string; contentType: string; sizeBytes: number; capturedAt: string }>>(
      "/attendance/media",
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
  /** Fetch a captured selfie (authenticated) as a blob for preview. */
  getMedia: async (token: string) => {
    const res = await api.get(`/attendance/media/${token}`, { responseType: "blob" });
    return res.data as Blob;
  },
  today: () => api.get<AttendanceRecordResponse>("/attendance/today"),
  me: (params: Record<string, unknown>) =>
    api.get<AttendanceListResponse>("/attendance/me", { params }),
  overview: (params: Record<string, unknown>) =>
    api.get<AttendanceListResponse>("/attendance", { params }),
  get: (id: string) => api.get<AttendanceRecordResponse>(`/attendance/${id}`),
  correct: (
    id: string,
    body: {
      field: "clockInAt" | "clockOutAt";
      oldValue: string | null;
      newValue: string | null;
      reason: string;
    }
  ) => api.post<ApiEnvelope<unknown>>(`/attendance/${id}/correct`, body),
};

/** Reporting API (FR-018 / FR-019). */
export const reportApi = {
  types: () => api.get<ReportTypesResponse>("/reports/types"),
  preview: (type: ReportTypeKey, params: Partial<ReportFilters>) =>
    api.get<ReportPreviewResponse>(`/reports/${type.toLowerCase()}`, { params }),
  // FR-006: PDF export removed — Excel (.xlsx) only.
  export: (type: ReportTypeKey, format: "excel", params: Partial<ReportFilters>) =>
    api.get(`/reports/${type.toLowerCase()}/export`, {
      params: { ...params, format },
      responseType: "blob",
    }),
};

/** Dashboard API (FR-025 / FR-026). */
export const dashboardApi = {
  me: () => api.get<PersonalDashboardResponse>("/dashboard/me"),
  hr: (params?: Record<string, unknown>) =>
    api.get<HrDashboardResponse>("/dashboard/hr", { params }),
};

/** Self-service profile API (FR-021). */
export const profileApi = {
  get: () => api.get<ProfileResponse>("/profile/me"),
  update: (body: ProfileUpdateDto) =>
    api.put<ProfileResponse>("/profile/me", body),
};

/** Organization structure API (FR-024 / FR-043). */
export const orgApi = {
  departments: () => api.get<OrgListResponse>("/org/departments"),
  activeDepartments: () => api.get<OrgListResponse>("/org/departments/active"),
  createDepartment: (body: { name: string; code?: string; description?: string }) =>
    api.post<OrgEntryResponse>("/org/departments", body),
  updateDepartment: (
    id: string,
    body: { name?: string; code?: string; description?: string }
  ) => api.put<OrgEntryResponse>(`/org/departments/${id}`, body),
  deactivateDepartment: (id: string) =>
    api.post<OrgEntryResponse>(`/org/departments/${id}/deactivate`),
  activateDepartment: (id: string) =>
    api.post<OrgEntryResponse>(`/org/departments/${id}/activate`),

  positions: () => api.get<OrgListResponse>("/org/positions"),
  activePositions: () => api.get<OrgListResponse>("/org/positions/active"),
  createPosition: (body: { name: string; description?: string }) =>
    api.post<OrgEntryResponse>("/org/positions", body),
  updatePosition: (id: string, body: { name?: string; description?: string }) =>
    api.put<OrgEntryResponse>(`/org/positions/${id}`, body),
  deactivatePosition: (id: string) =>
    api.post<OrgEntryResponse>(`/org/positions/${id}/deactivate`),
  activatePosition: (id: string) =>
    api.post<OrgEntryResponse>(`/org/positions/${id}/activate`),
};

/** Reporting-line API (FR-043). */
export const reportingApi = {
  assignManager: (userId: string, managerId: string | null) =>
    api.put(`/reporting/users/${userId}/manager`, { managerId }),
  directReports: (userId: string) =>
    api.get(`/reporting/users/${userId}/direct-reports`),
  managerHistory: (userId: string) =>
    api.get<ReportingHistoryResponse>(`/reporting/users/${userId}/manager-history`),
};

/** Notification API (FR-014 / FR-015). */
export const notificationApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<NotificationListResponse>("/notifications", { params }),
  unreadCount: () => api.get<UnreadCountResponse>("/notifications/unread-count"),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post("/notifications/read-all"),
  preferences: () => api.get<NotificationPreferencesResponse>("/notifications/preferences"),
  updatePreferences: (optOutTypes: string[]) =>
    api.put<NotificationPreferencesResponse>("/notifications/preferences", { optOutTypes }),
};
