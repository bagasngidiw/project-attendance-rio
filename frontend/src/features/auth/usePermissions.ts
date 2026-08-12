/**
 * usePermissions — access the current user's effective permission set
 * (design §6.2).
 */

import { useAuth } from "./useAuth";

export function usePermissions() {
  const { permissions, hasPermission } = useAuth();
  return { permissions, hasPermission };
}
