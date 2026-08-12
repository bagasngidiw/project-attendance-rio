/**
 * RequestModulePage — shared shell for the leave/overtime/trip pages:
 * submission form (gated) + my-requests list with status filter, pagination,
 * detail timeline, and cancel (only while PENDING).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { PermissionKey } from "@contracts/permissions";
import type { RequestDto, RequestStatus, RequestType } from "@contracts/requests";
import type { ApprovalTargetValue } from "@contracts/approvals";

import { requestApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Can } from "@/features/auth/Can";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";

import { RequestForm, type LeaveInput, type OvertimeInput, type TripInput } from "./RequestForm";
import { StatusBadge } from "./StatusBadge";
import { RequestDetailDialog } from "./RequestDetailDialog";
import { useLeaveTypeNames, leaveSummaryName } from "./useLeaveTypeNames";

const PAGE_SIZE = 10;

export function RequestModulePage({
  type,
  title,
  description,
  submitPermission,
  submit,
}: {
  type: RequestType;
  title: string;
  description: string;
  submitPermission: PermissionKey;
  submit: (
    input: LeaveInput | OvertimeInput | TripInput,
    approvalTarget: ApprovalTargetValue | null
  ) => Promise<string | null>;
}) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<RequestDto | null>(null);

  const params = { type, status: status || undefined, page, pageSize: PAGE_SIZE };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-requests", params],
    queryFn: () => requestApi.mine(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleSubmit(
    input: LeaveInput | OvertimeInput | TripInput,
    approvalTarget: ApprovalTargetValue | null
  ) {
    // FR-009: return the created request id so the form can upload an optional
    // attachment after the request exists.
    const created = await submit(input, approvalTarget);
    toast.success("Permintaan dikirim untuk disetujui.");
    setPage(1);
    refetch();
    return created;
  }

  async function handleCancel(reason: string) {
    if (!cancelling) return;
    try {
      await requestApi.cancel(cancelling.id, reason);
      toast.info("Permintaan dibatalkan.");
      setCancelling(null);
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Tidak dapat membatalkan permintaan ini.");
      setCancelling(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Can permission={submitPermission}>
          <RequestForm type={type} submit={handleSubmit} />
        </Can>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4">
            <div className="w-full sm:w-44">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Status
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Semua</option>
                <option value="PENDING">Menunggu</option>
                <option value="APPROVED">Disetujui</option>
                <option value="REJECTED">Ditolak</option>
                <option value="CANCELLED">Dibatalkan</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner label="Memuat permintaan..." />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Gagal memuat permintaan Anda.
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
              Belum ada permintaan {title.toLowerCase()}.
            </div>
          ) : (
            <>
              <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Ringkasan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Dikirim</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((request) => (
                      <tr key={request.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <SummaryCell request={request} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={request.status as RequestStatus} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                          {request.submittedAt
                            ? new Date(request.submittedAt).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setDetailId(request.id)}>
                              Detail
                            </Button>
                            {request.status === "PENDING_APPROVAL" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setCancelling(request)}
                              >
                                Batal
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-500">
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
        </div>
      </div>

      {detailId ? (
        <RequestDetailDialog requestId={detailId} onClose={() => setDetailId(null)} />
      ) : null}
      {cancelling ? (
        <CancelConfirmDialog
          onClose={() => setCancelling(null)}
          onConfirm={handleCancel}
        />
      ) : null}
    </div>
  );
}

function SummaryCell({ request }: { request: RequestDto }) {
  const names = useLeaveTypeNames();
  const p = request.payload as Record<string, string>;
  if (request.type === "LEAVE") {
    return (
      <div>
        <p className="font-medium">{leaveSummaryName(p, names)}</p>
        <p className="text-xs text-slate-500">
          {p.startDate} → {p.endDate}
        </p>
      </div>
    );
  }
  if (request.type === "OVERTIME") {
    return (
      <div>
        <p className="font-medium">Lembur</p>
        <p className="text-xs text-slate-500">
          {p.date} · {p.startTime}–{p.endTime}
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-medium">{p.destination}</p>
      <p className="text-xs text-slate-500">
        {p.startDate} → {p.endDate}
      </p>
    </div>
  );
}

function CancelConfirmDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(reason);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div className="relative max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-[var(--brand-surface)] p-4 shadow-xl sm:p-6">
          <h3 className="text-lg font-semibold">Batalkan permintaan</h3>
          <p className="mt-1 text-sm text-slate-500">
            Permintaan ini masih menunggu. Membatalkannya tidak dapat dibatalkan kembali.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan (opsional)"
            className="mt-4 h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Pertahankan
            </Button>
            <Button variant="danger" loading={submitting} onClick={handleConfirm}>
              Batalkan permintaan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
