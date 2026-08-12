/**
 * Route guards (design §6.3):
 *  - RequireAuth: redirects unauthenticated users to /login.
 *  - RequirePermission: redirects authenticated-but-unauthorized users to /403.
 *  - RequirePasswordChange: forces the first-sign-in password change gate
 *    (FR-028 §5.2) before the app shell renders.
 */

import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import type { PermissionKey } from "@contracts/permissions";

import { useAuth } from "./useAuth";
import { ROUTES } from "@/constants/routes";
import { Spinner } from "@/components/ui/Spinner";

export function RequireAuth() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Memulihkan sesi Anda..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey | PermissionKey[];
  children?: ReactNode;
}) {
  const { hasPermission, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Memulihkan sesi Anda..." />
      </div>
    );
  }

  if (!hasPermission(permission)) {
    return <Navigate to={ROUTES.FORBIDDEN} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}

/**
 * FR-028 first-sign-in gate: a user who must set their own password (or whose
 * password has expired under the policy, FR-044 §3.2) cannot reach the app
 * shell until they do. The change-password page is routed outside this guard
 * so it stays reachable.
 */
export function RequirePasswordChange({
  children,
}: {
  children?: ReactNode;
}) {
  const { user, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Memulihkan sesi Anda..." />
      </div>
    );
  }

  if (user?.mustChangePassword || user?.passwordExpired) {
    return <Navigate to={ROUTES.CHANGE_PASSWORD} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
