/**
 * RecentRequestsList — the user's latest requests with status badges
 * (FR-025 §6.2).
 */

import type { RecentRequestDto } from "@contracts/dashboard";

import { requestTypeLabel } from "@/lib/labels";
import { StatusBadge } from "@/features/requests/StatusBadge";

export function RecentRequestsList({ requests }: { requests: RecentRequestDto[] }) {
  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5 text-center text-sm text-slate-500">
        Belum ada permintaan.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        Permintaan terbaru
      </p>
      <ul className="space-y-3">
        {requests.map((request) => (
          <li key={request.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{request.summary}</p>
              <p className="text-xs text-slate-400">
                {requestTypeLabel(request.type)}
                {request.submittedAt
                  ? ` · ${new Date(request.submittedAt).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            <StatusBadge status={request.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
