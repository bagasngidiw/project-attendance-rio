/**
 * PunctualityBadge — renders the clock-in punctuality (ON_TIME / LATE) of an
 * attendance record. `null` means the record has no clock-in or the day is not
 * a scheduled work day for the employee (no punctuality is evaluated).
 */

import type { AttendancePunctuality } from "@contracts/attendance";

const STYLES: Record<NonNullable<AttendancePunctuality>, string> = {
  ON_TIME: "bg-emerald-50 text-emerald-700 border-emerald-200",
  LATE: "bg-amber-50 text-amber-700 border-amber-200",
};

const LABELS: Record<NonNullable<AttendancePunctuality>, string> = {
  ON_TIME: "Tepat waktu",
  LATE: "Terlambat",
};

export function PunctualityBadge({
  punctuality,
}: {
  punctuality: AttendancePunctuality;
}) {
  if (!punctuality) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[punctuality]}`}
    >
      {LABELS[punctuality]}
    </span>
  );
}
