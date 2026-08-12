/**
 * ReportTable — on-screen results preview with dynamic columns (FR-019 §6.2).
 */

import type { ReportRow, ReportTypeKey } from "@contracts/reports";

import { reportColumnLabel } from "@/lib/labels";

export function ReportTable({
  columns,
  rows,
  type,
}: {
  columns: string[];
  rows: ReportRow[];
  type: ReportTypeKey;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
        Tidak ada baris yang sesuai dengan filter saat ini.
      </div>
    );
  }

  return (
    <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">
                {reportColumnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-slate-50">
              {columns.map((column) => (
                <td key={column} className="max-w-56 truncate px-4 py-3">
                  {formatCell(row[column], type, column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown, type: ReportTypeKey, column: string): string {
  // FR-004: attendance rows created by approved-leave sync show a readable
  // "Sedang Cuti" instead of the raw LEAVE status.
  if (type === "ATTENDANCE" && column === "status" && value === "LEAVE") {
    return "Sedang Cuti";
  }
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString();
  }
  return String(value);
}
