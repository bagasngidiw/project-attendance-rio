/**
 * StatusBadge — consistent lifecycle labels (FR-016 §6.4): PENDING amber,
 * APPROVED green, REJECTED red, CANCELLED slate, DRAFT blue. Colors are fixed
 * defaults (status colors are not configurable).
 */

import type { RequestStatus } from "@contracts/requests";

import { requestStatusLabel } from "@/lib/labels";

const STYLES: Partial<Record<RequestStatus, string>> = {
  DRAFT: "bg-blue-50 text-blue-700",
  PENDING: "bg-amber-50 text-amber-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
  CANCELLED: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {requestStatusLabel(status)}
    </span>
  );
}
