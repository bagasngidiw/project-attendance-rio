/**
 * ReportCenterPage — the reporting surface (FR-018 / FR-019): report type
 * selector (including Sakit, FR-001), shared filter bar with free-text
 * employee search, results preview, and gated Excel export (FR-005).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type {
  ReportFilters,
  ReportTypeKey,
} from "@contracts/reports";

import { reportApi } from "@/lib/axios";
import { Spinner } from "@/components/ui/Spinner";

import { ReportFilterBar } from "./ReportFilterBar";
import { ReportTable } from "./ReportTable";
import { ExportButton } from "./ExportButton";

const PAGE_SIZE = 20;

export function ReportCenterPage() {
  const [type, setType] = useState<ReportTypeKey>("ATTENDANCE");
  const [filters, setFilters] = useState<Partial<ReportFilters>>({});
  const [page, setPage] = useState(1);

  const typesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: () => reportApi.types().then((r) => r.data.data?.items ?? []),
  });

  const params = { ...filters, page, pageSize: PAGE_SIZE };

  const previewQuery = useQuery({
    queryKey: ["report-preview", type, params],
    queryFn: () => reportApi.preview(type, params).then((r) => r.data.data),
    enabled: Boolean(type),
  });

  const types = typesQuery.data ?? [];
  const selectedType = types.find((t) => t.key === type);
  const data = previewQuery.data;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applyFilters(next: Partial<ReportFilters>) {
    setFilters(next);
    setPage(1);
  }

  function selectType(next: ReportTypeKey) {
    setType(next);
    setFilters({});
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Laporan</h2>
        <p className="text-sm text-slate-500">
          Buat laporan absensi, cuti, lembur, perjalanan dinas, dan sakit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {typesQuery.isLoading ? (
          <Spinner label="Memuat jenis laporan..." />
        ) : (
          types.map((t) => (
            <button
              key={t.key}
              onClick={() => selectType(t.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                t.key === type
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-[var(--brand-surface)] text-slate-700 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))
        )}
      </div>

      {selectedType ? (
        <ReportFilterBar type={type} initial={filters} onApply={applyFilters} />
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {selectedType ? `Laporan ${selectedType.label}` : ""} · {total} baris
        </p>
        <ExportButton type={type} filters={{ ...filters }} />
      </div>

      {previewQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat laporan..." />
        </div>
      ) : previewQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat laporan.
        </div>
      ) : selectedType ? (
        <ReportTable
          columns={selectedType.columns}
          rows={data?.items ?? []}
          type={type}
        />
      ) : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm text-slate-500">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
          >
            Sebelumnya
          </button>
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
          >
            Berikutnya
          </button>
        </div>
      ) : null}
    </div>
  );
}
