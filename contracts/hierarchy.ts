import type { ApiEnvelope } from "./auth";

export type HierarchyStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type HierarchyRelation =
  | "ROOT"
  | "CHILD"
  | "PARENT"
  | "SIBLING_BEFORE"
  | "SIBLING_AFTER";

export interface HierarchyNodeDto {
  nodeId: string;
  userId: string;
  parentNodeId: string | null;
  sortOrder: number;
}

export interface HierarchyDto {
  id: string;
  contractTypeId: string;
  placementId: string;
  status: HierarchyStatus;
  nodes: HierarchyNodeDto[];
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  users?: HierarchyUserDto[];
}

export interface HierarchyUserDto {
  userId: string;
  userName: string;
  username: string;
  nip: string;
  departmentId: string | null;
  positionId: string | null;
  roleNames: string[];
  status: string;
}

export interface HierarchyHistoryDto {
  id: string;
  hierarchyId: string;
  event: string;
  actorId: string | null;
  actorNameSnapshot: string | null;
  actorRoleNameSnapshots: string[];
  before: HierarchyNodeDto[] | null;
  after: HierarchyNodeDto[] | null;
  version: number | null;
  recordedAt: string | null;
}

export interface CreateHierarchyRequest {
  contractTypeId: string;
  placementId: string;
}

export interface AddHierarchyNodeRequest {
  userId: string;
  anchorNodeId?: string | null;
  relation: HierarchyRelation;
  expectedVersion: number;
}

export interface RemoveHierarchyNodeRequest {
  expectedVersion: number;
  promoteChildren?: boolean;
}

export interface MasterPlacementDto {
  id: string;
  key: string;
  name: string;
  status: string;
}

export type HierarchyResponse = ApiEnvelope<HierarchyDto>;
export type HierarchyListResponse = ApiEnvelope<HierarchyDto[]>;
export type HierarchyUsersResponse = ApiEnvelope<HierarchyUserDto[]>;
export type HierarchyHistoryResponse = ApiEnvelope<HierarchyHistoryDto[]>;
export type HierarchyPlacementsResponse = ApiEnvelope<MasterPlacementDto[]>;
