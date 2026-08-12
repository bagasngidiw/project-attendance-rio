/**
 * Audit & Activity DTO types — typed API contract for the audit/activity
 * consoles (FR-012 / FR-013), mirroring the backend presentation DTOs.
 */

import type { ApiEnvelope } from "./auth";

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

export interface AuditEventDto {
  id: string;
  action: string;
  category: "AUDIT";
  actor: {
    userId: string | null;
    roleKeys: string[];
    scope?: string;
  };
  subject: {
    type: string;
    id: string;
    summary: string;
  };
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  prevHash: string;
  hash: string;
  recordedAt: string;
}

export interface ActivityRecordDto {
  id: string;
  action: string;
  category: "ACTIVITY";
  actor: {
    userId: string | null;
  };
  subject: {
    type: string;
    id: string;
    summary: string;
  };
  correlationId: string;
  recordedAt: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditQueryParams {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  module?: string;
  subjectType?: string;
  outcome?: AuditOutcome;
  correlationId?: string;
  page?: number;
  pageSize?: number;
}

export interface ChainVerifyReport {
  valid: boolean;
  firstBrokenIndex: number | null;
  count: number;
}

export type AuditEventsResponse = ApiEnvelope<PageResult<AuditEventDto>>;
export type ActivityRecordsResponse = ApiEnvelope<PageResult<ActivityRecordDto>>;
export type ChainVerifyResponse = ApiEnvelope<ChainVerifyReport>;
