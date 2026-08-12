/**
 * Report DTO types (FR-018 / FR-019) — report types, preview rows, and the
 * shared filter shape used by both screen and export.
 */

import type { ApiEnvelope } from "./auth";

export type ReportTypeKey = "ATTENDANCE" | "LEAVE" | "OVERTIME" | "TRIP" | "SAKIT";

export interface ReportTypeDto {
  key: ReportTypeKey;
  label: string;
  columns: string[];
  filterableBy: string[];
}

export type ReportRow = Record<string, unknown>;

export interface ReportPreviewResult {
  items: ReportRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  employeeSearch?: string;
  employeeId?: string;
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

export type ReportTypesResponse = ApiEnvelope<{ items: ReportTypeDto[] }>;
export type ReportPreviewResponse = ApiEnvelope<ReportPreviewResult>;
