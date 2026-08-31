/**
 * EditUserDialog — update identity/org fields (FR-029 §4.1), the leave quota
 * (TODO.md FR-002: current/new/used/remaining + mandatory reason + preview)
 * and the employee work schedule (FR-011).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";
import { PERMISSIONS } from "@contracts/permissions";

import { leaveBalanceApi, rbacAdminApi, usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Can } from "@/features/auth/Can";
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
  // FR-003: role chips — initialized from the user's current roles (same
  // query key as CreateUserDialog so the role cache is shared).
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(user.roleIds ?? [])
  );

  const { data: roles } = useQuery({
    queryKey: ["rbac-admin-roles"],
    queryFn: () => rbacAdminApi.listRoles().then((r) => r.data.data ?? []),
  });

  function toggleRole(roleId: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  const rolesChanged =
    !readOnly &&
    JSON.stringify([...selectedRoles].sort()) !==
      JSON.stringify([...(user.roleIds ?? [])].sort());

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
    if (selectedRoles.size === 0) {
      setServerError("Tetapkan minimal satu peran.");
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
      // FR-003: persist role changes via the existing RBAC endpoint
      // (backend guards: users:assign_roles, last-SUPER_ADMIN, token bump).
      if (rolesChanged) {
        await rbacAdminApi.assignRoles(user.id, [...selectedRoles]);
      }
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
              : body?.code === "ROLE_DISABLED"
                ? "Peran dinonaktifkan dan tidak dapat diberikan."
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

        {/* FR-003: role/peran editor — same checkbox-chip pattern as the
            create dialog. Hidden in read-only mode and when the actor lacks
            users:assign_roles so a 403 never surprises the user. */}
        {!readOnly ? (
          <Can permission={PERMISSIONS.USERS_ASSIGN_ROLES}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Peran
              </label>
              <div className="flex flex-wrap gap-2">
                {(roles ?? []).map((role) => (
                  <label
                    key={role.id}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm has-checked:border-slate-900 has-checked:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoles.has(role.id)}
                      onChange={() => toggleRole(role.id)}
                      className="size-4 accent-slate-900"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
              {rolesChanged ? (
                <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  Peran akan diperbarui saat menyimpan.
                </p>
              ) : null}
            </div>
          </Can>
        ) : null}

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
