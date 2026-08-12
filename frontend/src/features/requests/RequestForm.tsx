/**
 * RequestForm — shared submission form with a per-type renderer (FR-036 /
 * FR-054 §6.1). Live payload validation mirrors the backend rules; the submit
 * button is gated by the caller via the module permission.
 *
 * LEAVE uses the configurable leave-type registry (FR-058) with the
 * "Tambahkan sendiri" suggestion flow; SAKIT uses its own dedicated page.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RequestType } from "@contracts/requests";
import type { ApprovalTargetValue } from "@contracts/approvals";

import { leaveTypeApi, leaveBalanceApi, attachmentApi } from "@/lib/axios";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { ApprovalTargetSelector } from "@/features/approval/ApprovalTargetSelector";
import { approvalTargetTypeFor } from "@/lib/approvalTarget";

export type LeaveInput = {
  leaveType: string;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  reason: string;
};

export type OvertimeInput = {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

export type TripInput = {
  destination: string;
  startDate: string;
  endDate: string;
  purpose: string;
};

export function RequestForm({
  type,
  submit,
}: {
  type: RequestType;
  submit: (
    input: LeaveInput | OvertimeInput | TripInput,
    approvalTarget: ApprovalTargetValue | null
  ) => Promise<string | null>;
}) {
  const [leave, setLeave] = useState<LeaveInput>({
    leaveType: "",
    leaveTypeName: "",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [overtime, setOvertime] = useState<OvertimeInput>({
    date: "",
    startTime: "",
    endTime: "",
    reason: "",
  });
  const [trip, setTrip] = useState<TripInput>({
    destination: "",
    startDate: "",
    endDate: "",
    purpose: "",
  });
  const [approvalTarget, setApprovalTarget] = useState<ApprovalTargetValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // FR-009: optional supporting file (Leave/Trip only; Overtime out of scope).
  const allowAttachment = type !== "OVERTIME";
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // "Tambahkan sendiri" untuk tipe cuti (status PENDING sampai diaktifkan admin).
  const [suggesting, setSuggesting] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestDescription, setSuggestDescription] = useState("");
  const [suggestMessage, setSuggestMessage] = useState<string | null>(null);
  const [suggestingLoading, setSuggestingLoading] = useState(false);

  const leaveTypesQuery = useQuery({
    queryKey: ["leave-types-active"],
    queryFn: () => leaveTypeApi.listActive().then((r) => r.data.data?.items ?? []),
    enabled: type === "LEAVE",
  });
  const activeLeaveTypes = leaveTypesQuery.data ?? [];

  // TODO.md FR-006/FR-007: the caller's balance for the selected type.
  const balancesQuery = useQuery({
    queryKey: ["leave-balances-self"],
    queryFn: () => leaveBalanceApi.listByUser().then((r) => r.data.data ?? []),
    enabled: type === "LEAVE",
  });
  const balances = balancesQuery.data ?? [];

  const selectedLeaveType = activeLeaveTypes.find((t) => t.id === leave.leaveType);
  const selectedBalance = balances.find((b) => b.leaveTypeId === leave.leaveType);
  const requestedDays =
    leave.startDate && leave.endDate
      ? Math.max(1, Math.round((+new Date(`${leave.endDate}T00:00:00Z`) - +new Date(`${leave.startDate}T00:00:00Z`)) / 864e5) + 1)
      : 0;
  const overQuota =
    Boolean(selectedLeaveType?.isBalanceBased) &&
    requestedDays > 0 &&
    requestedDays > (selectedBalance?.balance ?? 0);

  async function handleSuggestLeave(e: FormEvent) {
    e.preventDefault();
    if (!suggestName.trim()) {
      setSuggestMessage("Nama tipe cuti wajib diisi.");
      return;
    }
    setSuggestingLoading(true);
    setSuggestMessage(null);
    try {
      const res = await leaveTypeApi.suggest({
        name: suggestName.trim(),
        description: suggestDescription.trim() || undefined,
      });
      const suggested = res.data.data;
      setSuggestMessage(
        `Usulan “${suggested?.name ?? suggestName.trim()}” terkirim dan menunggu aktivasi administrator. Setelah aktif, tipe ini bisa dipilih pada form.`
      );
      setSuggestName("");
      setSuggestDescription("");
      setSuggesting(false);
      await leaveTypesQuery.refetch();
    } catch (err) {
      setSuggestMessage(apiErrorMessage(err) ?? "Tidak dapat mengirim usulan tipe cuti.");
    } finally {
      setSuggestingLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFileError(null);
    setSubmitting(true);
    try {
      const input =
        type === "LEAVE" ? leave : type === "OVERTIME" ? overtime : trip;
      if (type === "LEAVE" && !(input as LeaveInput).leaveType) {
        setError("Pilih tipe cuti terlebih dahulu.");
        return;
      }
      if (type === "LEAVE" && overQuota) {
        setError(
          `Sisa cuti tidak mencukupi. Sisa: ${selectedBalance?.balance ?? 0} hari, diminta: ${requestedDays} hari.`
        );
        return;
      }
      // Carry the resolved type name on the payload so summaries stay readable
      // even after the type is renamed or deactivated.
      const submitInput =
        type === "LEAVE"
          ? {
              ...(input as LeaveInput),
              leaveTypeName:
                activeLeaveTypes.find((t) => t.id === (input as LeaveInput).leaveType)?.name ?? "",
            }
          : input;
      const createdId = await submit(submitInput, approvalTarget);
      // FR-009: upload the optional attachment AFTER the request is created —
      // a failed upload never blocks the submission itself.
      if (allowAttachment && file && createdId) {
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
      // Reset on success so a follow-up submission starts clean.
      if (type === "LEAVE") {
        setLeave({ leaveType: "", leaveTypeName: "", startDate: "", endDate: "", reason: "" });
      } else if (type === "OVERTIME") {
        setOvertime({ date: "", startTime: "", endTime: "", reason: "" });
      } else {
        setTrip({ destination: "", startDate: "", endDate: "", purpose: "" });
      }
      setApprovalTarget(null);
      setFile(null);
      setFileError(null);
    } catch (err) {
      setError(
        apiErrorMessage(err) ??
          "Tidak dapat mengirim permintaan. Periksa nilainya dan coba lagi."
      );
    } finally {
      setSubmitting(false);
    }
  }

  /** FR-009: client-side attachment validation (PDF/PNG/JPG, max 5 MB). */
  function handleFileChange(next: File | null) {
    setFileError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const allowed = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
    ]);
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

  const heading =
    type === "LEAVE"
      ? "Permintaan cuti baru"
      : type === "OVERTIME"
        ? "Permintaan lembur baru"
        : "Permintaan perjalanan dinas baru";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5"
    >
      <h3 className="mb-4 font-semibold">{heading}</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        {type === "LEAVE" ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Pilih tipe cuti
              </label>
              <select
                value={leave.leaveType}
                onChange={(e) =>
                  setLeave((p) => ({ ...p, leaveType: e.target.value }))
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
                required
              >
                <option value="">— Pilih tipe —</option>
                {activeLeaveTypes.map((leaveType) => (
                  <option key={leaveType.id} value={leaveType.id}>
                    {leaveType.name}
                  </option>
                ))}
              </select>
              {leaveTypesQuery.isError ? (
                <p className="mt-1 text-xs text-red-600">
                  Gagal memuat tipe cuti. Muat ulang halaman dan coba lagi.
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => setSuggesting((s) => !s)}
                className="mt-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {suggesting ? "Tutup" : "+ Tambahkan sendiri"}
              </button>
            </div>
            <div className="hidden sm:block" />

            {selectedLeaveType?.isBalanceBased ? (
              <div
                className={`rounded-lg px-3 py-2 text-xs sm:col-span-2 ${
                  overQuota
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                <p>
                  Sisa Cuti: <span className="font-semibold">{selectedBalance?.balance ?? 0} hari</span>
                  {requestedDays > 0 ? (
                    <>
                      {" "}· Penggunaan: <span className="font-semibold">{requestedDays} hari</span>
                    </>
                  ) : null}
                </p>
                {overQuota ? (
                  <p>Sisa cuti tidak mencukupi untuk rentang tanggal ini.</p>
                ) : null}
              </div>
            ) : null}

            {suggesting ? (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 sm:col-span-2">
                <p className="mb-2 text-sm text-slate-600">
                  Tipe tidak tersedia? Usulkan nama tipe cuti baru. Usulan muncul
                  setelah diaktifkan oleh administrator.
                </p>
                <div className="space-y-3">
                  <Input
                    label="Nama tipe"
                    value={suggestName}
                    onChange={(e) => setSuggestName(e.target.value)}
                    placeholder="Mis. Cuti Melahirkan"
                    required
                  />
                  <Input
                    label="Deskripsi (opsional)"
                    value={suggestDescription}
                    onChange={(e) => setSuggestDescription(e.target.value)}
                    placeholder="Penjelasan singkat tipe cuti"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      loading={suggestingLoading}
                      onClick={handleSuggestLeave}
                    >
                      Kirim usulan
                    </Button>
                  </div>
                </div>
                {suggestMessage ? (
                  <p className="mt-2 rounded-md bg-indigo-100 px-3 py-2 text-xs text-indigo-800">
                    {suggestMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Input
              type="date"
              label="Tanggal mulai"
              value={leave.startDate}
              onChange={(e) => setLeave((p) => ({ ...p, startDate: e.target.value }))}
              required
            />
            <Input
              type="date"
              label="Tanggal selesai"
              value={leave.endDate}
              onChange={(e) => setLeave((p) => ({ ...p, endDate: e.target.value }))}
              required
            />
            <div className="sm:col-span-2">
              <Input
                label="Alasan"
                value={leave.reason}
                onChange={(e) => setLeave((p) => ({ ...p, reason: e.target.value }))}
                required
              />
            </div>
          </>
        ) : type === "OVERTIME" ? (
          <>
            <Input
              type="date"
              label="Tanggal"
              value={overtime.date}
              onChange={(e) => setOvertime((p) => ({ ...p, date: e.target.value }))}
              required
            />
            <div className="hidden sm:block" />
            <Input
              type="time"
              label="Waktu mulai"
              value={overtime.startTime}
              onChange={(e) =>
                setOvertime((p) => ({ ...p, startTime: e.target.value }))
              }
              required
            />
            <Input
              type="time"
              label="Waktu selesai"
              value={overtime.endTime}
              onChange={(e) =>
                setOvertime((p) => ({ ...p, endTime: e.target.value }))
              }
              required
            />
            <div className="sm:col-span-2">
              <Input
                label="Alasan"
                value={overtime.reason}
                onChange={(e) =>
                  setOvertime((p) => ({ ...p, reason: e.target.value }))
                }
                required
              />
            </div>
          </>
        ) : (
          <>
            <div className="sm:col-span-2">
              <Input
                label="Tujuan"
                value={trip.destination}
                onChange={(e) =>
                  setTrip((p) => ({ ...p, destination: e.target.value }))
                }
                required
              />
            </div>
            <Input
              type="date"
              label="Tanggal mulai"
              value={trip.startDate}
              onChange={(e) => setTrip((p) => ({ ...p, startDate: e.target.value }))}
              required
            />
            <Input
              type="date"
              label="Tanggal selesai"
              value={trip.endDate}
              onChange={(e) => setTrip((p) => ({ ...p, endDate: e.target.value }))}
              required
            />
            <div className="sm:col-span-2">
              <Input
                label="Tujuan kegiatan"
                value={trip.purpose}
                onChange={(e) =>
                  setTrip((p) => ({ ...p, purpose: e.target.value }))
                }
                required
              />
            </div>
          </>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        <ApprovalTargetSelector
          type={approvalTargetTypeFor(type)}
          value={approvalTarget}
          onChange={setApprovalTarget}
          // FR-006/FIX: only Overtime keeps the Role option; Leave/Trip show
          // only "Pilih Pengguna" (backend auto-resolves the default role).
          allowRole={type === "OVERTIME"}
        />
      </div>

      {allowAttachment ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4">
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
            <p className="mt-1 text-xs text-indigo-600">
              Mengunggah lampiran…
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={submitting || uploading}>
          Kirim permintaan
        </Button>
      </div>
    </form>
  );
}
