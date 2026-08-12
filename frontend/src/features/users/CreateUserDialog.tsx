/**
 * CreateUserDialog — provision a new account (FR-029): identity, roles, and a
 * policy-compliant temporary password with the must-change gate.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";

import { rbacAdminApi, usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PasswordHints } from "@/features/auth/PasswordHints";
import { DepartmentSelect, PositionSelect } from "@/features/org/OrgPicker";
import {
  QuotaAndScheduleSection,
  DEFAULT_QUOTA_SCHEDULE,
  type QuotaScheduleValue,
} from "./QuotaAndScheduleSection";

export function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    name: "",
    initialPassword: "",
    departmentId: "",
    positionId: "",
  });
  const [quotaSchedule, setQuotaSchedule] = useState<QuotaScheduleValue>(DEFAULT_QUOTA_SCHEDULE);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ["rbac-admin-roles"],
    queryFn: () => rbacAdminApi.listRoles().then((r) => r.data.data ?? []),
  });

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerError(null);
  }

  function toggleRole(roleId: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selectedRoles.size === 0) {
      setServerError("Tetapkan minimal satu peran.");
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await usersApi.create({
        ...form,
        departmentId: form.departmentId || null,
        positionId: form.positionId || null,
        roleIds: [...selectedRoles],
        jatahCuti:
          quotaSchedule.jatahCuti === "" ? undefined : Number(quotaSchedule.jatahCuti),
      });
      toast.success("Pengguna dibuat. Mereka harus menetapkan kata sandi saat masuk pertama.");
      onCreated();
    } catch (err) {
      const body = (err as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
      // Tampilkan pesan backend yang jelas (mis. "Role ... is disabled and
      // cannot be assigned.") agar pengguna memahami penyebabnya; fallback ke
      // pesan spesifik kode, lalu pesan generik.
      setServerError(
        apiErrorMessage(err) ??
          (body?.code === "USER_EXISTS"
            ? "Pengguna dengan nama pengguna atau email ini sudah ada."
            : body?.code === "PASSWORD_POLICY"
              ? "Kata sandi sementara tidak memenuhi kebijakan platform."
              : "Tidak dapat membuat pengguna.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Buat pengguna" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama pengguna"
          value={form.username}
          onChange={(e) => update("username", e.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          required
        />
        <Input
          label="Nama lengkap"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <DepartmentSelect
            value={form.departmentId}
            onChange={(id) => update("departmentId", id)}
          />
          <PositionSelect
            value={form.positionId}
            onChange={(id) => update("positionId", id)}
          />
        </div>

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
        </div>

        <Input
          label="Kata sandi sementara"
          type="password"
          autoComplete="new-password"
          value={form.initialPassword}
          onChange={(e) => update("initialPassword", e.target.value)}
          required
        />
        <PasswordHints password={form.initialPassword} />

        <QuotaAndScheduleSection value={quotaSchedule} onChange={setQuotaSchedule} />

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
            Batal
          </Button>
          <Button type="submit" loading={submitting}>
            Buat pengguna
          </Button>
        </div>
      </form>
    </Modal>
  );
}
