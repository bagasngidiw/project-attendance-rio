/**
 * ExceptionBadge — renders attendance exception type chips (FR-041 §6.2)
 * with distinct colors so anomalies are visibly distinguishable.
 */

import type { AttendanceException } from "@contracts/attendance";

const STYLES: Record<AttendanceException, string> = {
  MISSING_CLOCK_IN: "bg-rose-50 text-rose-700 border-rose-200",
  MISSING_CLOCK_OUT: "bg-orange-50 text-orange-700 border-orange-200",
  DUPLICATE: "bg-purple-50 text-purple-700 border-purple-200",
  CONFLICT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ANOMALY: "bg-amber-50 text-amber-700 border-amber-200",
};

const LABELS: Record<AttendanceException, string> = {
  MISSING_CLOCK_IN: "Absen masuk tidak ada",
  MISSING_CLOCK_OUT: "Absen keluar tidak ada",
  DUPLICATE: "Duplikat",
  CONFLICT: "Konflik",
  ANOMALY: "Anomali",
};

export function ExceptionBadge({ type }: { type: AttendanceException }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[type] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}
    >
      {LABELS[type] ?? type}
    </span>
  );
}

export function ExceptionChips({ types }: { types: AttendanceException[] }) {
  if (types.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {types.map((type) => (
        <ExceptionBadge key={type} type={type} />
      ))}
    </span>
  );
}
