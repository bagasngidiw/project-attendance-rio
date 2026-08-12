/**
 * Approval workflow DTO types (FR-007 / FR-008 / FR-042) — inbox, decisions,
 * history, and routing configuration.
 */

import type { ApiEnvelope } from "./auth";
import type { RequestDto, RequestEventDto, RequestListResult, RequestType } from "./requests";

export type { RequestDto, RequestListResult };

export type DecisionAction = "APPROVED" | "REJECTED";

/** Statuses the unified approval surface can filter by (FR-063). */
export type UnifiedApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Filters for the unified approval list/history (FR-063 GET /approvals). */
export interface UnifiedApprovalParams {
  type?: RequestType;
  status?: UnifiedApprovalStatus;
  employeeId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** GET /approvals/:id drill-down payload + history (FR-063). */
export interface ApprovalDrillDownResponse extends ApiEnvelope<{
  request: RequestDto;
  events: RequestEventDto[];
}> {}

/** GET /approvals/blocked-reason/:id cutoff/calendar block state (FR-063). */
export interface BlockedReasonResponse extends ApiEnvelope<{
  blocked: boolean;
  reason?: string;
}> {}

/** POST /approvals/:id/escalate acknowledgment (FR-063). */
export interface EscalateResponse extends ApiEnvelope<{
  ok: boolean;
  requestId: string;
  status: string;
}> {}

export interface RequestHistoryResponse extends ApiEnvelope<{
  request: RequestDto;
  events: RequestEventDto[];
}> {}

export interface RoutingRuleDto {
  requestType: "LEAVE" | "OVERTIME" | "TRIP";
  levels: Array<{ source: "MANAGER_OF_REQUESTER" }>;
  fallback: "ACTIVE_HR_ADMIN" | "SUPER_ADMIN";
  enabled: boolean;
}

export type RoutingRulesResponse = ApiEnvelope<RoutingRuleDto[]>;

// ─── FR-001: Superadmin approval configuration ──────────────────────────────

/** Request types covered by the configurable approval workflow (FR-001). */
export type ApprovalRequestType = "LEAVE" | "OVERTIME" | "TRIP" | "PERMISSION" | "SAKIT";

/** A single configured role entry inside one request-type configuration. */
export interface ApprovalConfigurationRoleDto {
  roleId: string;
  approvalLevel: number;
  canApprove: boolean;
  canBeTarget: boolean;
}

/** Full approval configuration for one request type (FR-001). */
export interface ApprovalConfigurationDto {
  requestType: ApprovalRequestType;
  roles: ApprovalConfigurationRoleDto[];
  selfApproval: boolean;
  version: number;
  updatedAt?: string | null;
}

/** PUT /approval-configurations/:requestType body (optimistic-lock guarded). */
export interface ApprovalConfigurationUpdateBody {
  roles: ApprovalConfigurationRoleDto[];
  selfApproval?: boolean;
  expectedVersion?: number;
}

export type ApprovalConfigurationsResponse = ApiEnvelope<ApprovalConfigurationDto[]>;
export type ApprovalConfigurationResponse = ApiEnvelope<ApprovalConfigurationDto>;

// ─── FR-003: eligible approval targets ───────────────────────────────────────

/** API `type` alias accepted by GET /approval-targets. */
export type ApprovalTargetType =
  | "overtime"
  | "business_trip"
  | "leave"
  | "permission"
  | "sakit";

/** Eligible ROLE target resolved by the backend (never a hardcoded role). */
export interface ApprovalTargetRoleDto {
  roleId: string;
  roleKey: string;
  roleName: string;
  approvalLevel: number;
  canBeTarget: boolean;
}

/** Eligible USER target resolved by the backend. */
export interface ApprovalTargetUserDto {
  userId: string;
  userName: string;
  username: string;
  roleId: string;
  roleName: string;
  approvalLevel: number;
}

/** GET /approval-targets?type=... payload. */
export interface ApprovalTargetsDto {
  roles: ApprovalTargetRoleDto[];
  users: ApprovalTargetUserDto[];
}

export type ApprovalTargetsResponse = ApiEnvelope<ApprovalTargetsDto>;

/** FR-002: requester-chosen approval target submitted with a request. */
export interface ApprovalTargetValue {
  targetType: "ROLE" | "USER";
  targetRoleId?: string;
  targetUserId?: string;
}
