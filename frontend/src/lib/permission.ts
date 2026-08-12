/**
 * Centralized permission helpers (FR-003/FR-004 foundation).
 *
 * All UI-level authorization flows through these functions so role checks
 * are never inlined in components.
 */

import type { PermissionKey } from "@contracts/permissions";

/** Wildcard permission granted by the SUPER_ADMIN seed role. */
const WILDCARD: PermissionKey | "*" = "*";

/**
 * @param permissions effective permission set of the current user
 * @param required permission(s) — any match grants access
 */
export function hasPermission(
  permissions: readonly (PermissionKey | "*")[] | undefined,
  required: PermissionKey | PermissionKey[]
): boolean {
  if (!permissions) return false;
  if (permissions.includes(WILDCARD)) return true;

  const requiredKeys = Array.isArray(required) ? required : [required];
  return requiredKeys.some((key) => permissions.includes(key));
}

/**
 * Grants access when the user holds ANY of the given keys (FR-004 batch
 * actions with multiple allowed variants).
 */
export function hasAnyPermission(
  permissions: readonly (PermissionKey | "*")[] | undefined,
  keys: readonly PermissionKey[]
): boolean {
  return hasPermission(permissions, [...keys]);
}

/** Grants access only when the user holds EVERY given key. */
export function hasAllPermissions(
  permissions: readonly (PermissionKey | "*")[] | undefined,
  keys: readonly PermissionKey[]
): boolean {
  if (!permissions) return false;
  if (permissions.includes(WILDCARD)) return true;
  return keys.every((key) => permissions.includes(key));
}

/** Returns only the permission-gated subset of items a user may access. */
export function filterByPermissions<T>(
  items: readonly T[],
  permissions: readonly (PermissionKey | "*")[] | undefined,
  getRequired: (item: T) => PermissionKey | PermissionKey[]
): T[] {
  return items.filter((item) => hasPermission(permissions, getRequired(item)));
}

/**
 * Permission-filters a nested sidebar tree: leaf items render when the user
 * holds any required permission; group items are pruned entirely when none
 * of their children are visible.
 */
export function filterSidebarItems<T extends { children?: T[]; permissions?: PermissionKey[] }>(
  items: readonly T[],
  permissions: readonly (PermissionKey | "*")[] | undefined
): T[] {
  const visible: T[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const children = filterSidebarItems(item.children, permissions);
      if (children.length > 0) {
        visible.push({ ...item, children });
      }
      continue;
    }
    if (hasPermission(permissions, item.permissions ?? [])) {
      visible.push(item);
    }
  }
  return visible;
}
