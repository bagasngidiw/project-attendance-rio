/**
 * Salary-slip DTO types (FR-006 / FR-007) — salary invoice slips uploaded by
 * SUPERADMIN to specific users. `storageKey` is never part of the contract.
 */

import type { ApiEnvelope } from "./auth";

export interface SalarySlipDto {
  id: string;
  userId: string;
  /** Receiver display name (resolved server-side; may be null). */
  receiverName?: string | null;
  senderId: string;
  senderName: string | null;
  payDate: string | null;
  periodLabel: string;
  notes: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string | null;
}

export interface SalarySlipListResult {
  items: SalarySlipDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type SalarySlipListResponse = ApiEnvelope<SalarySlipListResult>;
export type SalarySlipUploadResponse = ApiEnvelope<SalarySlipDto>;