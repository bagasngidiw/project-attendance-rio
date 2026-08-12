/**
 * Organization DTO types (FR-024 / FR-043).
 */

import type { ApiEnvelope } from "./auth";

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface PositionDto {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface ReportingHistoryEntryDto {
  id: string;
  userId: string;
  oldManagerId: string | null;
  newManagerId: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export type OrgListResponse = ApiEnvelope<{ items: DepartmentDto[] | PositionDto[] }>;
export type OrgEntryResponse = ApiEnvelope<DepartmentDto | PositionDto>;
export type ReportingHistoryResponse = ApiEnvelope<{ items: ReportingHistoryEntryDto[] }>;
