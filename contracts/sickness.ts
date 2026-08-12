/**
 * Sickness (Sakit) module DTO types — sickness-type master data consumed by
 * the Sakit submission form and its "Tambahkan sendiri" suggestion flow.
 */

import type { ApiEnvelope } from "./auth";

export type SicknessTypeStatus = "ACTIVE" | "PENDING" | "INACTIVE";

export interface SicknessTypeDto {
  id: string;
  key: string;
  name: string;
  description: string;
  status: SicknessTypeStatus;
  isSystem: boolean;
  suggestedBy: string | null;
  updatedAt: string | null;
}

export type SicknessTypeListResponse = ApiEnvelope<SicknessTypeDto[]>;
export type SicknessTypeResponse = ApiEnvelope<SicknessTypeDto>;
