/**
 * Auth + RBAC DTO types — typed API contract shared with the backend
 * (mirrors the backend presentation DTOs and §5.2 request/response shapes).
 */

import type { PermissionKey } from "./permissions";

export type UserStatus = "ACTIVE" | "INACTIVE" | "PENDING";

export type RoleKey =
  | "EMPLOYEE"
  | "MANAGER"
  | "HR_ADMIN"
  | "SUPER_ADMIN";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  name: string;
  status: UserStatus;
  mustChangePassword: boolean;
  passwordExpired?: boolean;
  roles: RoleKey[];
}

export interface SignInResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
  user: AuthUser;
  permissions: PermissionKey[];
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

export interface SessionResponse {
  user: AuthUser;
  permissions: PermissionKey[];
  roles: RoleKey[];
}

export interface MeResponse {
  id: string;
  username: string;
  email: string;
  name: string;
  status: UserStatus;
  roles: RoleKey[];
  permissions: PermissionKey[];
}

export interface ApiEnvelope<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    retryAfterMs?: number;
    field?: string;
    permissionKey?: string;
    violations?: string[];
  };
}

export interface RoleDto {
  id: string;
  key: RoleKey;
  name: string;
  description: string;
  isSystem: boolean;
  status: "ACTIVE" | "DISABLED";
  version: number;
  permissions: PermissionKey[];
}

export interface PermissionGroupDto {
  module: string;
  permissions: Array<{ key: string; description: string }>;
}

export interface AssignRolesResponse {
  userId: string;
  roles: RoleKey[];
}

/** Navigation tree node returned by GET /api/v1/navigation (FR-003). */
export interface NavigationNode {
  id: string;
  module?: string;
  label: string;
  /** Leaf nodes carry a route; group/section nodes do not. */
  path?: string;
  icon?: string;
  children: NavigationNode[];
}

/** Bulk permission check response item (FR-004 / access-check). */
export interface AccessCheckResult {
  key: string;
  granted: boolean;
}

