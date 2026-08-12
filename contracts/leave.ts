/**
 * Leave-type DTO types (FR-058) — master data for Cuti types, including the
 * "Tambahkan sendiri" suggestion flow (PENDING until an administrator
 * activates the type).
 */

import type { ApiEnvelope } from "./auth";

export type LeaveTypeStatus = "ACTIVE" | "PENDING" | "INACTIVE";

export interface LeaveTypeDto {
  id: string;
  key: string;
  name: string;
  description: string;
  isBalanceBased: boolean;
  maxDaysPerRequest: number | null;
  requiredSupportingInfo: boolean;
  status: LeaveTypeStatus;
  isSystem: boolean;
}

export interface CreateLeaveTypeInput {
  key: string;
  name: string;
  description?: string;
  isBalanceBased?: boolean;
  maxDaysPerRequest?: number | null;
  requiredSupportingInfo?: boolean;
}

// Backend leave-type list endpoints wrap the array in { items }.
export type LeaveTypeListResponse = ApiEnvelope<{ items: LeaveTypeDto[] }>;
export type LeaveTypeResponse = ApiEnvelope<LeaveTypeDto>;

/** TODO.md FR-004/FR-007: per-type balance summary for a user/year. */
export interface LeaveBalanceDto {
  leaveTypeId: string;
  leaveTypeKey: string;
  name: string;
  year: number;
  entitlementDays: number;
  adjustmentDays: number;
  consumedDays: number;
  reservedDays: number;
  balance: number;
}

export type LeaveBalancesResponse = ApiEnvelope<LeaveBalanceDto[]>;
