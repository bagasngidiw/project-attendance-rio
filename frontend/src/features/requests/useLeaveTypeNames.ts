/**
 * useLeaveTypeNames / useSicknessTypeNames — resolve master-data type ids to
 * display names across summary cells (my requests, approval inbox, drill-downs,
 * dashboard). Uses shared react-query keys with the submission forms so the
 * active-type payloads are fetched/cached once.
 *
 * `leaveTypeName` / `sicknessTypeName` stored on the payload (set at
 * submission) win; otherwise the id is resolved against the active registry;
 * legacy keys fall back to the built-in label map.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { leaveTypeApi, sicknessTypeApi } from "@/lib/axios";
import { leaveTypeLabel } from "@/lib/labels";

export function useLeaveTypeNames(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["leave-types-active"],
    queryFn: () => leaveTypeApi.listActive().then((r) => r.data.data?.items ?? []),
    staleTime: 60_000,
  });
  return useMemo(
    () => Object.fromEntries((data ?? []).map((t) => [t.id, t.name])),
    [data]
  );
}

/** Renders the leave type name for a LEAVE payload. */
export function leaveSummaryName(
  payload: Record<string, unknown>,
  names: Record<string, string>
): string {
  const p = payload as Record<string, string>;
  return p.leaveTypeName || names[p.leaveType] || leaveTypeLabel(p.leaveType);
}

export function useSicknessTypeNames(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["sickness-types-active"],
    queryFn: () => sicknessTypeApi.list().then((r) => r.data.data ?? []),
    staleTime: 60_000,
  });
  return useMemo(
    () => Object.fromEntries((data ?? []).map((t) => [t.id, t.name])),
    [data]
  );
}

/** Renders the sickness type name for a SAKIT payload. */
export function sicknessSummaryName(
  payload: Record<string, unknown>,
  names: Record<string, string>
): string {
  const p = payload as Record<string, string>;
  return p.sicknessTypeName || names[p.sicknessType] || "";
}
