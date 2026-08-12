/**
 * Permission (Ijin) — FR-007. Create form (single date or date range + reason +
 * requester-chosen approval target) plus the caller's own permission request
 * list with status badge, detail dialog, and cancel for pending rows.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ApprovalTargetValue } from "@contracts/approvals";
import type { RequestDto, RequestStatus } from "@contracts/requests";
import { PERMISSIONS } from "@contracts/permissions";

import { permissionApi, requestApi, attachmentApi } from "@/lib/axios";
import { toast } from "@/lib/toast";
import { apiErrorMessage } from "@/lib/apiError";
import { Can } from "@/features/auth/Can";
import { ApprovalTargetSelector } from "@/features/approval/ApprovalTargetSelector";
import { approvalTargetTypeFor } from "@/lib/approvalTarget";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { RequestDetailDialog } from "@/features/requests/RequestDetailDialog";

const PAGE_SIZE = 10;

export default function Permission() {
  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<ApprovalTargetValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // FR-009: optional supporting file.
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<RequestDto | null>(null);

  const params = {
    type: "PERMISSION",
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-requests", params],
    queryFn: () => requestApi.mine(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** FR-006: target is optional — the backend auto-resolves the default role. */
  function targetMissing(): string | null {
    if (target?.targetType === "ROLE" && !target.targetRoleId) {
      return "Pilih peran penyetuju.";
    }
    if (target?.targetType === "USER" && !target.targetUserId) {
      return "Pilih pengguna penyetuju.";
    }
    return null;
  }

  /** FR-009: client-side attachment validation (PDF/PNG/JPG, max 5 MB). */
  function handleFileChange(next: File | null) {
    setFileError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg"]);
    const extAllowed = /\.(pdf|png|jpe?g)$/i.test(next.name);
    if (!allowed.has(next.type) && !extAllowed) {
      setFileError("Tipe file tidak didukung. Gunakan PDF, PNG, atau JPG.");
      setFile(null);
      return;
    }
    if (next.size > 5 * 1024 * 1024) {
      setFileError("Ukuran file maksimal 5 MB.");
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const missingTarget = targetMissing();
    if (mode === "single" && !date) {
      setError("Tanggal wajib diisi.");
      return;
    }
    if (mode === "range" && (!startDate || !endDate)) {
      setError("Tanggal mulai dan tanggal selesai wajib diisi.");
      return;
    }
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    if (missingTarget) {
      setError(missingTarget);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await permissionApi.submit({
        ...(mode === "single"
          ? { date }
          : { startDate, endDate }),
        reason: reason.trim(),
        approvalTarget: target ?? undefined,
      });
      // FR-009: upload the optional attachment AFTER the request is created.
      const createdId = res.data.data?.id ?? null;
      if (file && createdId) {
        setUploading(true);
        try {
          await attachmentApi.upload(createdId, file);
          toast.success("Lampiran berhasil diunggah.");
        } catch (uploadErr) {
          toast.error(
            `${apiErrorMessage(uploadErr) ?? "Gagal mengunggah lampiran."} Permintaan sudah terkirim; lampiran dapat ditambahkan dari detail.`
          );
        } finally {
          setUploading(false);
        }
      }
      toast.success("Ijin diajukan untuk disetujui.");
      setDate("");
      setStartDate("");
      setEndDate("");
      setReason("");
      setTarget(null);
      setFile(null);
      setFileError(null);
      setPage(1);
      refetch();
    } catch (err) {
      setError(
        apiErrorMessage(err) ||
          "Tidak dapat mengirim permintaan. Periksa nilainya dan coba lagi."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(reasonText: string) {
    if (!cancelling) return;
    await requestApi.cancel(cancelling.id, reasonText);
    toast.info("Permintaan dibatalkan.");
    setCancelling(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Ijin</h2>
        <p className="text-sm text-slate-500">
          Ajukan permintaan ijin (satu hari atau rentang tanggal) dan pantau
          statusnya.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Can permission={PERMISSIONS.PERMISSION_SUBMIT}>
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5"
          >
            <h3 className="mb-4 font-semibold">Permintaan ijin baru</h3>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="permission-period"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                    className="size-4 accent-slate-900"
                  />
                  Satu hari
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="permission-period"
                    checked={mode === "range"}
                    onChange={() => setMode("range")}
                    className="size-4 accent-slate-900"
                  />
                  Beberapa hari
                </label>
              </div>

              {mode === "single" ? (
                <Input
                  type="date"
                  label="Tanggal"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    type="date"
                    label="Tanggal mulai"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                  <Input
                    type="date"
                    label="Tanggal selesai"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              )}

              <Input
                label="Alasan"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan permintaan ijin"
                required
              />

              <ApprovalTargetSelector
                type={approvalTargetTypeFor("PERMISSION")}
                value={target}
                onChange={setTarget}
                allowRole={false}
              />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Lampiran (opsional)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
                {file ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </p>
                ) : null}
                {fileError ? (
                  <p className="mt-1 text-xs text-red-600">{fileError}</p>
                ) : null}
                {uploading ? (
                  <p className="mt-1 text-xs text-indigo-600">Mengunggah lampiran…</p>
                ) : null}
              </div>

              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button type="submit" loading={submitting || uploading}>
                  Ajukan Ijin
                </Button>
              </div>
            </div>
          </form>
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
                <option value="PENDING_APPROVAL">Menunggu</option>
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
              Belum ada permintaan ijin.
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
                          <PermissionSummaryCell request={request} />
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
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setDetailId(request.id)}
                            >
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
        <CancelPermissionDialog
          onClose={() => setCancelling(null)}
          onConfirm={handleCancel}
        />
      ) : null}
    </div>
  );
}

function PermissionSummaryCell({ request }: { request: RequestDto }) {
  const p = request.payload as Record<string, string>;
  return (
    <div>
      <p className="font-medium">Ijin</p>
      <p className="text-xs text-slate-500">
        {p.date ? p.date : `${p.startDate} → ${p.endDate}`}
      </p>
    </div>
  );
}

function CancelPermissionDialog({
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
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div className="relative max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-[var(--brand-surface)] p-4 shadow-xl sm:p-6">
          <h3 className="text-lg font-semibold">Batalkan permintaan ijin</h3>
          <p className="mt-1 text-sm text-slate-500">
            Permintaan ini masih menunggu. Membatalkannya tidak dapat dibatalkan
            kembali.
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
