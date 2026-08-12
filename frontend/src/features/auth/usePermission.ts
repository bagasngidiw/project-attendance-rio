/**
 * usePermission — permission helpers for action-level UI gating (FR-004,
 * design §6.1 `usePermission`). Prefer these over calling useAuth directly.
 */

import { useCallback } from "react";

import type { PermissionKey } from "@contracts/permissions";

import { useAuth } from "./useAuth";

export function usePermission() {
  const { permissions, hasPermission } = useAuth();

  const hasAnyPermission = useCallback(
    (keys: readonly PermissionKey[]) => {
      if (!permissions) return false;
      if (permissions.includes("*" as PermissionKey)) return true;
      return keys.some((key) => permissions.includes(key));
    },
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (keys: readonly PermissionKey[]) => {
      if (!permissions) return false;
      if (permissions.includes("*" as PermissionKey)) return true;
      return keys.every((key) => permissions.includes(key));
    },
    [permissions]
  );

  return { hasPermission, hasAnyPermission, hasAllPermissions };
}
