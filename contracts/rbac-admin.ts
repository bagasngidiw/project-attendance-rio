/**
 * RBAC Admin Console DTO types (FR-011) — typed contract for the role and
 * permission configuration console, mirroring the backend presentation DTOs.
 * FR-064 adds role levels, data scopes, the role wizard metadata, and
 * validate/preview/copy support.
 */

import type { ApiEnvelope, RoleKey } from "./auth";
import type { PermissionKey } from "./permissions";

export type RoleStatus = "ACTIVE" | "DISABLED";

/** Data-scope of a role: how far its data access extends (FR-064). */
export type RoleDataScope =
  | "SELF"
  | "DIRECT_SUBORDINATES"
  | "DIRECT_AND_INDIRECT_SUBORDINATES"
  | "DEPARTMENT"
  | "ALL_EMPLOYEES";

export interface AdminRoleDto {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  status: RoleStatus;
  level: number;
  levelLabel: string;
  dataScope: RoleDataScope;
  version: number;
  permissions: PermissionKey[];
}

export interface MatrixPermissionDto {
  key: PermissionKey;
  description: string;
  grantedTo: string[];
}

export interface MatrixModuleDto {
  module: string;
  permissions: MatrixPermissionDto[];
}

export interface MatrixResponse {
  modules: MatrixModuleDto[];
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissions: PermissionKey[];
  level?: number;
  levelLabel?: string;
  dataScope?: RoleDataScope;
  templateKey?: string;
  copyFromRoleId?: string;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  level?: number;
  levelLabel?: string;
  dataScope?: RoleDataScope;
  expectedVersion: number;
}

export interface SetPermissionsRequest {
  permissions: PermissionKey[];
  reason?: string;
  expectedVersion: number;
}

export interface ToggleRoleStatusRequest {
  expectedVersion: number;
}

export interface SetPermissionsResponse {
  roleId: string;
  permissions: PermissionKey[];
  appliedAt: string;
  affectedUsers: number;
}

export interface ToggleRoleStatusResponse {
  roleId: string;
  status: RoleStatus;
  affectedUsers: number;
}

export interface EffectivePermissionBreakdown {
  roleId: string;
  roleKey: string;
  permissions: PermissionKey[];
}

export interface EffectivePermissionsResponse {
  userId: string;
  username: string;
  roles: RoleKey[];
  permissions: PermissionKey[];
  breakdown: EffectivePermissionBreakdown[];
}

export type AdminRoleResponse = ApiEnvelope<AdminRoleDto>;
export type AdminRolesListResponse = ApiEnvelope<AdminRoleDto[]>;
export type MatrixResponseEnvelope = ApiEnvelope<{ modules: MatrixModuleDto[] }>;
export type SetPermissionsResponseEnvelope = ApiEnvelope<SetPermissionsResponse>;
export type ToggleRoleStatusEnvelope = ApiEnvelope<ToggleRoleStatusResponse>;
export type EffectivePermissionsEnvelope = ApiEnvelope<EffectivePermissionsResponse>;

// ─── FR-064: role levels, templates & wizard metadata ───────────────────────

/** A permission row inside a checklist group. */
export interface ChecklistPermissionDto {
  key: PermissionKey;
  description: string;
}

/** A collapsible permission group shown by the role wizard checklist. */
export interface ChecklistGroupDto {
  key: string;
  label: string;
  permissions: ChecklistPermissionDto[];
}

/** A starting-point role template (never injects hidden permissions). */
export interface RoleTemplateDto {
  key: string;
  name: string;
  description: string;
  baseLevel: number;
  baseScope: RoleDataScope;
  /** `["*"]` when the template resolves to every registered permission. */
  basePermissions: string[];
}

/** A dependency warning: `permission` granted but none of `requires` present. */
export interface DependencyWarningDto {
  permission: string;
  requires: string[];
  label: string;
}

/** Suggested default data scope per level band (suggestion only, not enforced). */
export interface LevelScopeSuggestion {
  minLevel: number;
  maxLevel: number;
  scope: RoleDataScope;
}

/** Level/scope schema returned by the console metadata endpoint. */
export interface RoleLevelMetaDto {
  dataScopes: RoleDataScope[];
  defaultLevel: number;
  defaultScope: RoleDataScope;
  scopeSuggestions: LevelScopeSuggestion[];
}

/** GET /rbac/admin/meta — wizard metadata (groups, templates, deps, level schema). */
export interface RoleMetaResponse {
  groups: ChecklistGroupDto[];
  templates: RoleTemplateDto[];
  dependencyMap: DependencyWarningDto[];
  highPrivilegePermissions: string[];
  roleLevel: RoleLevelMetaDto;
}

/** POST /rbac/admin/roles/validate request body. */
export interface ValidateRoleRequest {
  permissions: PermissionKey[];
  level?: number;
  levelLabel?: string;
  dataScope?: RoleDataScope;
}

/** POST /rbac/admin/roles/validate response (warnings only, no persistence). */
export interface ValidateRoleResponse {
  permissions: PermissionKey[];
  level: number;
  dataScope: RoleDataScope;
  dependencies: DependencyWarningDto[];
  highPrivilege: string[];
}

/** Effective-access preview (menus/approval/reports/admin) for a role. */
export interface RolePreviewResponse {
  role: {
    key: string;
    name: string;
    level: number;
    levelLabel: string;
    dataScope: RoleDataScope;
  };
  groups: ChecklistGroupDto[];
  warnings: {
    dependencies: DependencyWarningDto[];
    highPrivilege: string[];
  };
  preview: {
    menuModules: Array<{ module: string; permissions: string[] }>;
    approvalAuthority: string[];
    reportPermissions: string[];
    adminCapabilities: string[];
  };
}

/** GET /rbac/admin/roles/copy/:sourceId — editable draft of an existing role. */
export interface RoleCopyDraft {
  name: string;
  description: string;
  level: number;
  levelLabel: string;
  dataScope: RoleDataScope;
  permissions: PermissionKey[];
  source: { id: string; key: string };
}

export type RoleMetaEnvelope = ApiEnvelope<RoleMetaResponse>;
export type ValidateRoleEnvelope = ApiEnvelope<ValidateRoleResponse>;
export type RolePreviewEnvelope = ApiEnvelope<RolePreviewResponse>;
export type RoleCopyEnvelope = ApiEnvelope<RoleCopyDraft>;
