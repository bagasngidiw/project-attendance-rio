/**
 * ReportFilterBar — shared filters (FR-019): date range, free-text employee
 * search (name/username, FR-003), and a type-specific status select. Applied
 * identically to the preview and the export.
 */

import { useState, type FormEvent } from "react";

import type { ReportFilters, ReportTypeKey } from "@contracts/reports";

import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function ReportFilterBar({
  type,
  initial,
  onApply,
}: {
  type: ReportTypeKey;
  initial: Partial<ReportFilters>;
  onApply: (filters: Partial<ReportFilters>) => void;
}) {
  const [values, setValues] = useState<Partial<ReportFilters>>(initial);

  function update(key: keyof ReportFilters, value: string) {
    setValues((prev) => ({ ...prev, [key]: value || undefined }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onApply(values);
  }

  const statusOptions =
    type === "ATTENDANCE"
      ? [
          ["", "Semua"],
          ["NORMAL", "Normal"],
          ["EXCEPTION", "Pengecualian"],
        ]
      : [
          ["", "Semua"],
          ["PENDING", "Menunggu"],
          ["APPROVED", "Disetujui"],
          ["REJECTED", "Ditolak"],
          ["CANCELLED", "Dibatalkan"],
        ];

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4"
    >
      <div className="w-full sm:w-44">
        <Input type="date" label="Dari" value={values.from ?? ""} onChange={(e) => update("from", e.target.value)} />
      </div>
      <div className="w-full sm:w-44">
        <Input type="date" label="Sampai" value={values.to ?? ""} onChange={(e) => update("to", e.target.value)} />
      </div>
      <div className="w-full sm:w-56">
        <Input label="Cari karyawan" placeholder="Cari nama / username" value={values.employeeSearch ?? ""} onChange={(e) => update("employeeSearch", e.target.value)} />
      </div>
      <div className="w-full sm:w-40">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Status
        </label>
        <select
          className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
          value={values.status ?? ""}
          onChange={(e) => update("status", e.target.value)}
        >
          {statusOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="md">
        Terapkan filter
      </Button>
    </form>
  );
}
