/**
 * Manager Team DTO types — typed API contract for the team overview surface
 * (FR-006), mirroring the backend `ManagerTeamService` response shapes.
 */

import type { ApiEnvelope } from "./auth";

export interface TeamMemberDto {
  id: string;
  username: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
  roles: string[];
}

/** Pending-request counts keyed by HR module (providers register per FR-027). */
export interface PendingSummaryDto {
  attendance: number;
  leave: number;
  overtime: number;
  trip: number;
}

export interface TeamOverviewDto {
  manager: {
    id: string;
    username: string;
    email: string;
    name: string;
  };
  members: TeamMemberDto[];
  pendingSummary: PendingSummaryDto;
  memberCount: number;
}

export type TeamOverviewResponse = ApiEnvelope<TeamOverviewDto>;
export type TeamMemberResponse = ApiEnvelope<TeamMemberDto>;
