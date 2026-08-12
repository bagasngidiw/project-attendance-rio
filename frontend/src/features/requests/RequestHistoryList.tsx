/**
 * RequestHistoryList — consolidated employee request history across leave,
 * overtime, and business trip (FR-037): filters + pagination + detail view.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RequestDto } from "@contracts/requests";

import { requestApi } from "@/lib/axios";
import { requestTypeLabel } from "@/lib/labels";
import { Spinner } from "@/components/ui/Spinner";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "./StatusBadge";
import { RequestDetailDialog } from "./RequestDetailDialog";

const PAGE_SIZE = 10;

export function RequestHistoryList() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = {
    status: status || undefined,
    type: type || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-requests", params],
    queryFn: () => requestApi.mine(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
        }}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4"
      >
        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="PENDING">Menunggu</option>
            <option value="APPROVED">Disetujui</option>
            <option value="REJECTED">Ditolak</option>
            <option value="CANCELLED">Dibatalkan</option>
          </select>
        </div>
        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Jenis
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="LEAVE">Cuti</option>
            <option value="OVERTIME">Lembur</option>
            <option value="TRIP">Perjalanan Dinas</option>
            <option value="PERMISSION">Ijin</option>
            <option value="SAKIT">Sakit</option>
          </select>
        </div>
        <div className="w-full sm:w-44">
          <Input type="date" label="Dari" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <Input type="date" label="Sampai" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit" size="md">
          Terapkan
        </Button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat permintaan Anda..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat permintaan Anda.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Tidak ada permintaan yang sesuai dengan filter saat ini.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3">Permintaan</th>
                  <th className="px-4 py-3">Tanggal</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Keputusan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((request) => (
                  <tr
                    key={request.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setDetailId(request.id)}
                  >
                    <td className="px-4 py-3 text-xs font-medium">{requestTypeLabel(request.type)}</td>
                    <td className="px-4 py-3 font-medium">
                      {(request as RequestDto & { summary?: string }).summary ?? requestTypeLabel(request.type)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDates(request)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={request.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {request.decision
                        ? `${request.decision.action}${request.decision.comment ? ` — ${request.decision.comment}` : ""}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} permintaan</span>
            <div className="flex items-center gap-2">
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
          </div>
        </>
      )}

      {detailId ? (
        <RequestDetailDialog requestId={detailId} onClose={() => setDetailId(null)} />
      ) : null}
    </div>
  );
}

function formatDates(request: RequestDto): string {
  const p = request.payload as Record<string, string>;
  if (request.type === "OVERTIME") return p.date ?? "—";
  if (p.startDate && p.endDate) return `${p.startDate} → ${p.endDate}`;
  return p.startDate ?? "—";
}
