/**
 * BlockedReasonBanner — amber notice shown when a request cannot be decided
 * because a cutoff/calendar rule blocks it (FR-063 U.5.5).
 */

import { TriangleAlert } from "lucide-react";

export function BlockedReasonBanner({ reason }: { reason?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {reason?.trim()
          ? reason
          : "Permintaan ini diblokir oleh aturan batas waktu atau kalender dan tidak dapat diputuskan saat ini."}
      </p>
    </div>
  );
}
