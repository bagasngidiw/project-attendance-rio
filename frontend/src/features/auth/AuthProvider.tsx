/**
 * AuthProvider — session bootstrap, sign-in, sign-out, permission context.
 *
 * Holds the authenticated user, effective permissions and roles, plus the
 * access/refresh tokens. On mount it attempts to restore a session from the
 * stored refresh token (design §6.2 bootstrap flow).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AuthUser } from "@contracts/auth";
import type { PermissionKey } from "@contracts/permissions";

import { AuthContext, type AuthContextValue } from "./AuthContext";
import {
  clearAuthStorage,
  getRefreshToken,
  setRefreshToken,
  setSessionId,
} from "@/lib/auth-storage";
import {
  authApi,
  refreshAccessToken,
  setAccessToken,
  setOnSessionExpired,
} from "@/lib/axios";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  // Clears every cached query on auth changes so no data from the previous
  // account (navigation, lists, notifications) leaks into the new session.
  const queryClient = useQueryClient();

  const applyAuth = useCallback((data: {
    user: AuthUser;
    permissions: PermissionKey[];
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  }) => {
    setUser(data.user);
    setPermissions(data.permissions);
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    setSessionId(data.sessionId);
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setAccessToken(null);
    clearAuthStorage();
    // Drop every React Query cache entry tied to the old session.
    queryClient.clear();
  }, [queryClient]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      // Start the new session with a clean cache (previous role's data gone).
      queryClient.clear();
      const { data } = await authApi.signIn(username, password);
      if (!data.data) {
        throw new Error("Respons masuk tidak memiliki data.");
      }
      applyAuth(data.data);
      return data.data;
    },
    [applyAuth, queryClient]
  );

  const signOut = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await authApi.signOut(refreshToken);
      } catch {
        // Local logout proceeds even if the server session is already gone.
      }
    }
    clearAuth();
  }, [clearAuth]);

  const signOutAll = useCallback(async () => {
    try {
      await authApi.signOutAll();
    } catch {
      // Best-effort; local state is cleared regardless.
    }
    clearAuth();
  }, [clearAuth]);

  /** Restores a session from the stored refresh token (bootstrap). */
  const refreshSession = useCallback(async () => {
    const token = await refreshAccessToken();
    if (!token) {
      clearAuth();
      return;
    }
    try {
      const { data } = await authApi.getSession();
      if (data.data) {
        setUser(data.data.user);
        setPermissions(data.data.permissions);
      }
    } catch {
      clearAuth();
    }
  }, [clearAuth]);

  const hasPermission = useCallback(
    (required: PermissionKey | PermissionKey[]) => {
      if (!permissions) return false;
      if (permissions.includes("*" as PermissionKey)) return true;
      const keys = Array.isArray(required) ? required : [required];
      return keys.some((key) => permissions.includes(key));
    },
    [permissions]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setIsBootstrapping(false);
        return;
      }
      await refreshSession();
      if (!cancelled) setIsBootstrapping(false);
    })();

    setOnSessionExpired(() => {
      if (!cancelled) {
        clearAuth();
        setIsBootstrapping(false);
        window.location.href = "/login";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshSession, clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      roles: user?.roles ?? [],
      isAuthenticated: Boolean(user),
      isBootstrapping,
      signIn,
      signOut,
      signOutAll,
      hasPermission,
      refreshSession,
    }),
    [
      user,
      permissions,
      isBootstrapping,
      signIn,
      signOut,
      signOutAll,
      hasPermission,
      refreshSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
