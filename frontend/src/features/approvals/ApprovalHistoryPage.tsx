/**
 * ApprovalHistoryPage — FR-008 decisions recorded by the caller, with a
 * read-only detail + timeline.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { approvalApi } from "@/lib/axios";
import { requestTypeLabel } from "@/lib/labels";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { RequestTimeline } from "@/features/requests/RequestTimeline";

const PAGE_SIZE = 10;

export function ApprovalHistoryPage() {
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = { type: type || undefined, page, pageSize: PAGE_SIZE };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["approval-history", params],
    queryFn: () => approvalApi.history(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Riwayat Persetujuan</h2>
        <p className="text-sm text-slate-500">
          Permintaan yang telah Anda putuskan.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4">
        <div className="w-full sm:w-44">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Jenis
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
                <option value="">Semua jenis</option>
                <option value="LEAVE">Cuti</option>
                <option value="OVERTIME">Lembur</option>
                <option value="TRIP">Perjalanan Dinas</option>
                <option value="PERMISSION">Ijin</option>
                <option value="SAKIT">Sakit</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat riwayat..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat riwayat persetujuan.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Belum ada keputusan yang tercatat.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Pemohon</th>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3">Keputusan</th>
                  <th className="px-4 py-3">Komentar</th>
                  <th className="px-4 py-3">Diputuskan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((request) => (
                  <tr key={request.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {request.requesterName ?? shortId(request.requesterId)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{requestTypeLabel(request.type)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={request.status} />
                    </td>
                    <td className="max-w-56 truncate px-4 py-3 text-xs text-slate-600">
                      {request.decision?.comment || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {request.decision?.decidedAt
                        ? new Date(request.decision.decidedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDetailId(request.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
                      >
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} keputusan</span>
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
        <HistoryDetailDialog requestId={detailId} onClose={() => setDetailId(null)} />
      ) : null}
    </div>
  );
}

function HistoryDetailDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["request-history", requestId],
    queryFn: () => approvalApi.requestHistory(requestId).then((r) => r.data.data),
  });

  return (
    <Modal title="Detail keputusan" onClose={onClose}>
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner label="Memuat..." />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-slate-400">{requestTypeLabel(data.request.type)}</p>
            <StatusBadge status={data.request.status} />
          </div>
          <RequestTimeline events={data.events} />
        </div>
      )}
    </Modal>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
