/**
 * RequestSummaryCard — the user's request counts by status and type
 * (FR-025 §6.2).
 */

import type { RequestSummaryDto } from "@contracts/dashboard";

export function RequestSummaryCard({ summary }: { summary: RequestSummaryDto }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Permintaan
      </p>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <SummaryStat label="Menunggu" value={summary.pending} tone="text-amber-600" />
        <SummaryStat label="Disetujui" value={summary.approved} tone="text-green-600" />
        <SummaryStat label="Ditolak" value={summary.rejected} tone="text-red-600" />
        <SummaryStat label="Dibatalkan" value={summary.cancelled} tone="text-slate-500" />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-500">Berdasarkan jenis</p>
        <div className="flex gap-4 text-sm">
          <span className="text-slate-700">Cuti: {summary.byType.leave}</span>
          <span className="text-slate-700">Lembur: {summary.byType.overtime}</span>
          <span className="text-slate-700">Perjalanan dinas: {summary.byType.trip}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
