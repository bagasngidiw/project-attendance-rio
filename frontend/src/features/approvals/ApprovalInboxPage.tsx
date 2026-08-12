/**
 * ApprovalInboxPage — FR-007 approval inbox: PENDING requests assigned to the
 * caller, with type filter, pagination, and a review/decision surface.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RequestDto, RequestType } from "@contracts/requests";

import { approvalApi } from "@/lib/axios";
import { requestTypeLabel } from "@/lib/labels";
import { useLeaveTypeNames, leaveSummaryName, useSicknessTypeNames, sicknessSummaryName } from "@/features/requests/useLeaveTypeNames";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";

import { RequestDecisionCard } from "./RequestDecisionCard";
import { StatusBadge } from "@/features/requests/StatusBadge";

const PAGE_SIZE = 10;

export function ApprovalInboxPage() {
  const [type, setType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<RequestDto | null>(null);

  const params = { type: type || undefined, page, pageSize: PAGE_SIZE };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["approval-inbox", params],
    queryFn: () => approvalApi.inbox(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Kotak Masuk Persetujuan</h2>
        <p className="text-sm text-slate-500">
          Permintaan yang menunggu keputusan Anda.
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
          <Spinner label="Memuat kotak masuk..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat kotak masuk.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Kotak masuk Anda kosong.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Pemohon</th>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3">Ringkasan</th>
                  <th className="px-4 py-3">Dikirim</th>
                  <th className="px-4 py-3">Status</th>
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
                      <SummaryCell request={request} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {request.submittedAt
                        ? new Date(request.submittedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={request.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setReviewing(request)}>
                        Tinjau
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} menunggu</span>
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

      {reviewing ? (
        <RequestDecisionCard
          request={reviewing}
          onClose={() => setReviewing(null)}
          onDecided={() => {
            setReviewing(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCell({ request }: { request: RequestDto }) {
  const names = useLeaveTypeNames();
  const sicknessNames = useSicknessTypeNames();
  const p = request.payload as Record<string, string>;
  if (request.type === "LEAVE") {
    return (
      <div>
        <p className="font-medium">{leaveSummaryName(p, names)}</p>
        <p className="text-xs text-slate-500">{p.startDate} → {p.endDate}</p>
      </div>
    );
  }
  if (request.type === "OVERTIME") {
    return (
      <div>
        <p className="font-medium">Lembur</p>
        <p className="text-xs text-slate-500">{p.date} · {p.startTime}–{p.endTime}</p>
      </div>
    );
  }
  if (request.type === "PERMISSION") {
    return (
      <div>
        <p className="font-medium">Ijin</p>
        <p className="text-xs text-slate-500">
          {p.date ? p.date : `${p.startDate} → ${p.endDate}`}
        </p>
      </div>
    );
  }
  if (request.type === "SAKIT") {
    const name = sicknessSummaryName(p, sicknessNames);
    const range = p.endDate && p.endDate !== p.startDate
      ? `${p.startDate} → ${p.endDate}`
      : p.startDate;
    return (
      <div>
        <p className="font-medium">{name || "Sakit"}</p>
        <p className="text-xs text-slate-500">{range}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-medium">{p.destination}</p>
      <p className="text-xs text-slate-500">{p.startDate} → {p.endDate}</p>
    </div>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export type { RequestType };
