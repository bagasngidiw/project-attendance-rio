/**
 * Dashboard DTO types (FR-025 / FR-026) — personal and HR summary shapes.
 */

import type { ApiEnvelope } from "./auth";
import type { RequestStatus, RequestType } from "./requests";

export type AttendanceTodayStatus = "CLOCKED_IN" | "CLOCKED_OUT" | "NOT_STARTED";

export interface AttendanceTodayDto {
  status: AttendanceTodayStatus;
  clockInAt: string | null;
  clockOutAt: string | null;
}

export interface RequestSummaryDto {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  byType: { leave: number; overtime: number; trip: number };
}

export interface RecentRequestDto {
  id: string;
  type: RequestType;
  status: RequestStatus;
  submittedAt: string | null;
  summary: string;
}

export interface PersonalDashboardDto {
  attendanceToday: AttendanceTodayDto;
  requestSummary: RequestSummaryDto;
  recentRequests: RecentRequestDto[];
  quickActions: string[];
}

export interface DepartmentCountDto {
  departmentId: string | null;
  name: string | null;
  count: number;
}

export interface HrDashboardDto {
  workforce: { totalActiveEmployees: number; byDepartment: DepartmentCountDto[] };
  attendanceSummary: { clockedInToday: number; notStarted: number; exceptions: number };
  pendingRequests: { leave: number; overtime: number; trip: number; total: number };
  recentApprovals: Array<{
    id: string;
    type: RequestType;
    requesterName: string;
    status: RequestStatus;
    decidedAt: string;
  }>;
}

export type PersonalDashboardResponse = ApiEnvelope<PersonalDashboardDto>;
export type HrDashboardResponse = ApiEnvelope<HrDashboardDto>;
