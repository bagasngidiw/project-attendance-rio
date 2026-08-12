/**
 * Request DTO types (FR-016 / FR-036 / FR-054) — shared by the leave,
 * overtime, and business trip module surfaces.
 */

import type { ApiEnvelope } from "./auth";

export type RequestType = "LEAVE" | "OVERTIME" | "TRIP" | "PERMISSION" | "SAKIT";
export type RequestStatus =
  | "DRAFT"
  | "PENDING"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface RequestEventDto {
  id: string;
  event: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EDITED" | "ASSIGNED" | "CLAIMED" | "ESCALATED";
  actorId: string | null;
  // FR-009: immutable actor/role name snapshots for the history timeline.
  actorNameSnapshot?: string | null;
  actorRoleId?: string | null;
  actorRoleNameSnapshot?: string | null;
  comment: string;
  fromStatus: string;
  toStatus: string;
  recordedAt: string;
}

/** FR-002: the embedded approval structure (target, assignment, snapshot). */
export interface RequestApprovalDto {
  targetType: "ROLE" | "USER" | null;
  targetRoleId: string | null;
  targetUserId: string | null;
  assignedUserId: string | null;
  assignedAt: string | null;
  status: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  configurationSnapshot: {
    requestType?: string;
    targetType?: string;
    targetRoleId?: string | null;
    targetRoleName?: string | null;
    targetRoleLevel?: number | null;
    targetUserId?: string | null;
    targetUserName?: string | null;
  } | null;
}

export interface RequestDto {
  id: string;
  type: RequestType;
  requesterId: string;
  status: RequestStatus;
  payload: Record<string, unknown>;
  approverId: string | null;
  // Human-readable names resolved by the approval surface (FR-007/FR-063);
  // null when the related user is missing.
  requesterName?: string | null;
  approverName?: string | null;
  cancellationReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  cancelledAt: string | null;
  approvalStep?: number;
  approvalChain?: Array<{
    step: number;
    approverId: string | null;
    status: string;
  }>;
  // FR-002: the requester-chosen target, claimed/assigned approver and snapshot.
  approval?: RequestApprovalDto | null;
  decision?: {
    action: "APPROVED" | "REJECTED";
    actorId: string | null;
    comment: string;
    decidedAt: string | null;
  } | null;
  version: number;
  events?: RequestEventDto[];
}

export interface RequestListResult {
  items: RequestDto[];
  page: number;
  pageSize: number;
  total: number;
}

export type RequestDetailResponse = ApiEnvelope<RequestDto>;
export type RequestListResponse = ApiEnvelope<RequestListResult>;
