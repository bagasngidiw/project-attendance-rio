/**
 * SalarySlipsPage (FR-006 / FR-007) — "Slip Gaji".
 *
 * Receivers see their own salary invoice slips (columns include "Pengirim
 * Gaji") and can download them through the authenticated axios session
 * (blob fetch, never anonymous links). SUPERADMIN additionally sees an upload
 * form (penerima + tanggal gajian + periode + keterangan + file) and a
 * "Dikirim" list of every slip.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";
import { PERMISSIONS } from "@contracts/permissions";
import type { SalarySlipDto } from "@contracts/salary-slips";

import { salarySlipApi, usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { usePermission } from "@/features/auth/usePermission";

const PAGE_SIZE = 20;

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

async function downloadSlip(item: SalarySlipDto) {
  try {
    const blob = await salarySlipApi.download(item.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(apiErrorMessage(err) ?? "Tidak dapat mengunduh slip gaji.");
  }
}

export function SalarySlipsPage() {
  const { hasAnyPermission } = usePermission();
  const canManage = hasAnyPermission([PERMISSIONS.SALARY_MANAGE]);

  // Upload form state (SUPERADMIN only).
  const [receiverId, setReceiverId] = useState("");
  const [payDate, setPayDate] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mine = useQuery({
    queryKey: ["salary-slips-mine", { page: 1, pageSize: PAGE_SIZE }],
    queryFn: () => salarySlipApi.listMine({ page: 1, pageSize: PAGE_SIZE }).then((r) => r.data.data),
  });

  const sent = useQuery({
    queryKey: ["salary-slips-all", { page: 1, pageSize: PAGE_SIZE }],
    queryFn: () => salarySlipApi.listAll({ page: 1, pageSize: PAGE_SIZE }).then((r) => r.data.data),
    enabled: canManage,
  });

  const receivers = useQuery({
    queryKey: ["salary-slips-users"],
    queryFn: () =>
      usersApi.list({ page: 1, pageSize: 100, status: "ACTIVE" }).then((r) => r.data.data?.items ?? []),
    enabled: canManage,
  });

  function invalidate() {
    mine.refetch();
    if (canManage) sent.refetch();
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!receiverId) {
      setServerError("Penerima wajib dipilih.");
      return;
    }
    if (!payDate) {
      setServerError("Tanggal gajian wajib diisi.");
      return;
    }
    if (!periodLabel.trim()) {
      setServerError("Periode gaji wajib diisi.");
      return;
    }
    if (!file) {
      setServerError("File slip gaji wajib dilampirkan.");
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await salarySlipApi.upload(receiverId, file, {
        payDate,
        periodLabel: periodLabel.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success("Slip gaji terkirim.");
      setReceiverId("");
      setPayDate("");
      setPeriodLabel("");
      setNotes("");
      setFile(null);
      invalidate();
    } catch (err) {
      const body = (err as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
      setServerError(apiErrorMessage(err) ?? body?.message ?? "Tidak dapat mengunggah slip gaji.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Slip Gaji</h2>
        <p className="text-sm text-slate-500">
          Invoice slip gaji yang dikirimkan ke akun Anda.
        </p>
      </div>

      {canManage ? (
        <form
          onSubmit={handleUpload}
          className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5"
        >
          <h3 className="mb-1 font-semibold">Kirim Slip Gaji</h3>
          <p className="mb-4 text-sm text-slate-500">
            Unggah invoice slip gaji untuk pengguna tertentu.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Penerima
              </label>
              <select
                value={receiverId}
                onChange={(e) => setReceiverId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
              >
                <option value="">Pilih penerima…</option>
                {(receivers.data ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                    {user.contractName ? ` — ${user.contractName}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Tanggal gajian"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              required
            />
            <Input
              label="Periode gaji"
              placeholder="contoh: Juli 2026"
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              maxLength={64}
              required
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                File slip (PDF/PNG/JPG, maks 5 MB)
              </label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
              {file ? (
                <p className="mt-1 text-xs text-slate-500">
                  {file.name} · {formatSize(file.size)}
                </p>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Keterangan (opsional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={512}
                rows={2}
                className="w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {serverError ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {serverError}
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button type="submit" loading={submitting}>
              Kirim slip
            </Button>
          </div>
        </form>
      ) : null}

      {/* Received slips */}
      <section className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold">{canManage ? "Diterima oleh saya" : "Slip Gaji Saya"}</h3>
          <p className="text-sm text-slate-500">
            {canManage
              ? "Slip yang dikirimkan ke akun Anda."
              : "Invoice slip gaji yang dikirimkan ke akun Anda."}
          </p>
        </div>

        {mine.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner label="Memuat slip gaji..." />
          </div>
        ) : mine.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Gagal memuat slip gaji.
          </div>
        ) : (mine.data?.items ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada slip gaji.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Periode</th>
                  <th className="px-4 py-3">Tanggal Gajian</th>
                  <th className="px-4 py-3">Pengirim Gaji</th>
                  <th className="px-4 py-3">Nama File</th>
                  <th className="px-4 py-3">Ukuran</th>
                  <th className="px-4 py-3">Diunggah</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(mine.data?.items ?? []).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{item.periodLabel}</td>
                    <td className="px-4 py-3">{formatDate(item.payDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{item.senderName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{item.fileName}</td>
                    <td className="px-4 py-3 text-slate-600">{formatSize(item.sizeBytes)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button size="sm" variant="secondary" onClick={() => downloadSlip(item)}>
                          Unduh
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sent slips (SUPERADMIN) */}
      {canManage ? (
        <section className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold">Dikirim</h3>
            <p className="text-sm text-slate-500">Semua slip gaji yang telah diunggah.</p>
          </div>

          {sent.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner label="Memuat slip terkirim..." />
            </div>
          ) : sent.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Gagal memuat slip terkirim.
            </div>
          ) : (sent.data?.items ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Belum ada slip gaji yang dikirim.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Periode</th>
                    <th className="px-4 py-3">Tanggal Gajian</th>
                    <th className="px-4 py-3">Penerima</th>
                    <th className="px-4 py-3">Nama File</th>
                    <th className="px-4 py-3">Ukuran</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(sent.data?.items ?? []).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{item.periodLabel}</td>
                      <td className="px-4 py-3">{formatDate(item.payDate)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {item.receiverName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{item.fileName}</td>
                      <td className="px-4 py-3 text-slate-600">{formatSize(item.sizeBytes)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button size="sm" variant="secondary" onClick={() => downloadSlip(item)}>
                            Unduh
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}