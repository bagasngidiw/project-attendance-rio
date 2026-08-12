/**
 * useNavigation — fetches the user's filtered navigation tree from the server
 * (FR-003, design §4.1). Falls back to the local permission-filtered MENU if
 * the API is unreachable, so the shell still renders.
 *
 * The query is keyed by the signed-in user's id so switching accounts (sign
 * out → sign in as another role) can never show the previous role's menu.
 */

import { useQuery } from "@tanstack/react-query";

import type { NavigationNode } from "@contracts/auth";

import { api } from "@/lib/axios";
import { useAuth } from "@/features/auth/useAuth";

async function fetchNavigation(): Promise<NavigationNode[]> {
  const { data } = await api.get<{ data: NavigationNode[] }>("/navigation");
  return data.data ?? [];
}

export function useNavigation() {
  const { user } = useAuth();
  return useQuery({
    // Scoped by user id + a short stale time: after an account switch the old
    // role's tree is never served from the cache.
    queryKey: ["navigation", user?.id ?? "anon"],
    queryFn: fetchNavigation,
    staleTime: 0,
    retry: 1,
  });
}
