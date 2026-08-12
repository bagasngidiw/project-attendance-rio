/**
 * EditUserDialog — update identity/org fields (FR-029 §4.1), the leave quota
 * (TODO.md FR-002: current/new/used/remaining + mandatory reason + preview)
 * and the employee work schedule (FR-011).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";

import { leaveBalanceApi, usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useLeaveTypeNames } from "@/features/requests/useLeaveTypeNames";
import { ContractTypeSelect, PlacementSelect } from "@/features/admin/MasterSelects";

import type { UserListItem } from "./types";
import {
  QuotaAndScheduleSection,
  type QuotaScheduleValue,
} from "./QuotaAndScheduleSection";

export function EditUserDialog({
  user,
  onClose,
  onSaved,
  readOnly = false,
}: {
  user: UserListItem;
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    nip: user.nip ?? "",
    contractTypeId: user.contractTypeId ?? "",
    placementId: user.placementId ?? "",
  });
  const [quotaSchedule, setQuotaSchedule] = useState<QuotaScheduleValue>({
    jatahCuti: "",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
    workingEndTime: "17:00",
  });
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["leave-balances", user.id],
    queryFn: () => leaveBalanceApi.listByUser(user.id).then((r) => r.data.data ?? []),
  });

  const leaveNames = useLeaveTypeNames();

  // Current total / used / remaining across balance-based types (self summary).
  const current = balances ?? [];
  const totalQuota = current.reduce((sum, b) => sum + (b.entitlementDays ?? 0) + (b.adjustmentDays ?? 0), 0);
  const used = current.reduce((sum, b) => sum + (b.consumedDays ?? 0), 0);
  const remaining = current.reduce((sum, b) => sum + (b.balance ?? 0), 0);

  const newQuota = quotaSchedule.jatahCuti === "" ? null : Number(quotaSchedule.jatahCuti);
  const hasQuotaChange = newQuota !== null && newQuota !== totalQuota;
  const diff = hasQuotaChange && newQuota !== null ? newQuota - totalQuota : 0;

  // Seed the editable quota/schedule with the current values once loaded.
  useEffect(() => {
    if (balancesLoading || !balances || balances.length === 0) return;
    // Seed-once data-sync pattern; runs after the async balance query resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuotaSchedule((prev) => ({
      ...prev,
      jatahCuti: String(
        balances.reduce((s, b) => s + (b.entitlementDays ?? 0) + (b.adjustmentDays ?? 0), 0) || ""
      ),
    }));
  }, [balancesLoading, balances]);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (hasQuotaChange && !reason.trim()) {
      setServerError("Alasan perubahan jatah cuti wajib diisi.");
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await usersApi.update(user.id, {
        ...form,
        nip: form.nip.trim() || undefined,
        contractTypeId: form.contractTypeId || null,
        placementId: form.placementId || null,
        ...(hasQuotaChange ? { jatahCuti: newQuota ?? 0, reason: reason.trim() } : {}),
      });
      await usersApi.updateWorkSchedule(user.id, {
        workingDays: quotaSchedule.workingDays,
        workingStartTime: quotaSchedule.workingStartTime,
        workingEndTime: quotaSchedule.workingEndTime,
      });
      toast.success("Pengguna diperbarui.");
      onSaved();
    } catch (err) {
      const body = (err as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
      setServerError(
        apiErrorMessage(err) ??
          (body?.code === "LEAVE_QUOTA_NEGATIVE"
            ? "Jatah cuti tidak dapat dikurangi karena sisa akan negatif."
            : body?.code === "USER_EXISTS"
              ? "Pengguna lain sudah memiliki email ini."
              : "Tidak dapat memperbarui pengguna.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={readOnly ? `Lihat ${user.name}` : `Edit ${user.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama lengkap"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          required
          disabled={readOnly}
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          required
          disabled={readOnly}
        />
        <Input
          label="NIP"
          value={form.nip}
          onChange={(e) => update("nip", e.target.value)}
          maxLength={64}
          placeholder="Nomor Induk Pegawai (opsional)"
          disabled={readOnly}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <ContractTypeSelect
            value={form.contractTypeId}
            onChange={(id) => update("contractTypeId", id)}
            disabled={readOnly}
          />
          <PlacementSelect
            value={form.placementId}
            onChange={(id) => update("placementId", id)}
            disabled={readOnly}
          />
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="font-semibold">Jatah Cuti Saat Ini</h4>
          {balancesLoading ? (
            <Spinner label="Memuat saldo..." className="py-3" />
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-2 text-center">
                <p className="text-xs text-slate-500">Total</p>
                <p className="font-semibold">{totalQuota} hari</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2 text-center">
                <p className="text-xs text-slate-500">Terpakai</p>
                <p className="font-semibold">{used} hari</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2 text-center">
                <p className="text-xs text-slate-500">Sisa</p>
                <p className="font-semibold">{remaining} hari</p>
              </div>
            </div>
          )}
          {current.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {current.map((b) => (
                <li key={b.leaveTypeId}>
                  {leaveNames[b.leaveTypeId] ?? b.leaveTypeKey} — {b.balance} hari
                </li>
              ))}
            </ul>
          ) : null}

          {hasQuotaChange ? (
            <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Perubahan: {diff > 0 ? `+${diff}` : diff} hari (baru: {newQuota} hari)
            </p>
          ) : null}
          {hasQuotaChange && !readOnly ? (
            <div className="mt-3">
              <Input
                label="Alasan perubahan jatah cuti"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Wajib diisi saat jatah cuti berubah"
                required
              />
            </div>
          ) : null}
        </div>

        <QuotaAndScheduleSection
          value={quotaSchedule}
          onChange={setQuotaSchedule}
          disabled={readOnly}
        />

        {serverError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {serverError}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {readOnly ? "Tutup" : "Batal"}
          </Button>
          {!readOnly ? (
            <Button type="submit" loading={submitting}>
              Simpan
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
