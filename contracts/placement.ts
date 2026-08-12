/**
 * Placement master data DTO types (NEW UPDATE TAD SIMBIKA) consumed by
 * the Master Data tabs and the user create/edit forms.
 */

import type { ApiEnvelope } from "./auth";

export type PlacementStatus = "ACTIVE" | "INACTIVE";

export interface PlacementDto {
  id: string;
  key: string;
  name: string;
  description: string;
  status: PlacementStatus;
  updatedAt: string | null;
}

export type PlacementListResponse = ApiEnvelope<PlacementDto[]>;
export type PlacementResponse = ApiEnvelope<PlacementDto>;
