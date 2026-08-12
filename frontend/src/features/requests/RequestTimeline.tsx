/**
 * RequestTimeline — immutable transition history (FR-008/FR-009), read-only.
 * Shared by the requester detail dialog and the approval surfaces. Renders
 * localized event labels, the actor name snapshot ("oleh …") and the
 * rejection comment.
 */

import type { RequestEventDto } from "@contracts/requests";

import { requestEventLabel, requestStatusLabel } from "@/lib/labels";

export function RequestTimeline({ events }: { events: RequestEventDto[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-400">Belum ada riwayat.</p>;
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <div className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300" />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {requestEventLabel(event.event)}
                <span className="ml-2 text-xs text-slate-400">
                  {event.fromStatus ? requestStatusLabel(event.fromStatus) : ""}
                  {event.fromStatus && event.toStatus ? " → " : ""}
                  {event.toStatus ? requestStatusLabel(event.toStatus) : ""}
                </span>
              </span>
              <span className="text-xs text-slate-400">
                {new Date(event.recordedAt).toLocaleString()}
              </span>
            </div>
            {event.actorNameSnapshot ? (
              <p className="text-xs text-slate-500">
                oleh <span className="font-medium text-slate-700">{event.actorNameSnapshot}</span>
                {event.actorRoleNameSnapshot
                  ? ` (${event.actorRoleNameSnapshot})`
                  : null}
              </p>
            ) : null}
            {event.comment ? (
              <p className="text-xs text-slate-500">“{event.comment}”</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
