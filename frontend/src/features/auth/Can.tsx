/**
 * Can — action-level UI gate (FR-004, design §6.1 `<Can permission=...>`).
 * Renders children only when the user holds the required permission(s).
 * Never render a hidden action as the only control — the API boundary
 * re-authorizes every call (FR-005).
 */

import type { ReactNode } from "react";

import type { PermissionKey } from "@contracts/permissions";

import { usePermission } from "./usePermission";

export function Can({
  permission,
  fallback = null,
  children,
}: {
  /** Single key or list — ANY match renders children. */
  permission: PermissionKey | readonly PermissionKey[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { hasAnyPermission } = usePermission();
  const keys = Array.isArray(permission) ? permission : [permission];

  if (!hasAnyPermission(keys)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
