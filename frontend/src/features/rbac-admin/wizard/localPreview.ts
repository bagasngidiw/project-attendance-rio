/**
 * Local effective-access preview (FR-064) — computed client-side from the
 * wizard's currently selected permissions, mirroring the backend's
 * `buildValidationReport` preview shape so the wizard can show the same
 * summary before a role is created (preview requires an existing role).
 */

import type { PermissionKey } from "@contracts/permissions";

export interface LocalMenuModule {
  module: string;
  permissions: string[];
}

export interface LocalPreview {
  menuModules: LocalMenuModule[];
  approvalAuthority: string[];
  reportPermissions: string[];
  adminCapabilities: string[];
}

/**
 * Summarizes the selected permission set into menus, approval authority,
 * reporting and admin capabilities. `highPrivilege` is the meta-provided
 * high-privilege permission list used to flag admin capabilities.
 */
export function buildLocalPreview(
  permissions: readonly PermissionKey[],
  highPrivilege: readonly string[]
): LocalPreview {
  const unique = [...new Set(permissions)].sort();
  const menuMap = new Map<string, string[]>();
  for (const key of unique) {
    const module = (key.split(":")[0] ?? "").toUpperCase();
    const existing = menuMap.get(module) ?? [];
    existing.push(key);
    menuMap.set(module, existing);
  }

  return {
    menuModules: [...menuMap.entries()].map(([module, perms]) => ({
      module,
      permissions: perms,
    })),
    approvalAuthority: unique.filter(
      (key) => key.endsWith(":approve") || key.endsWith(":review")
    ),
    reportPermissions: unique.filter((key) => key.startsWith("reporting:")),
    adminCapabilities: unique.filter((key) => highPrivilege.includes(key)),
  };
}
