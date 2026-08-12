/**
 * Contract-type master data DTO types (NEW UPDATE TAD SIMBIKA) consumed by
 * the Master Data tabs and the user create/edit forms.
 */

import type { ApiEnvelope } from "./auth";

export type ContractTypeStatus = "ACTIVE" | "INACTIVE";

export interface ContractTypeDto {
  id: string;
  key: string;
  name: string;
  description: string;
  status: ContractTypeStatus;
  updatedAt: string | null;
}

export type ContractTypeListResponse = ApiEnvelope<ContractTypeDto[]>;
export type ContractTypeResponse = ApiEnvelope<ContractTypeDto>;
