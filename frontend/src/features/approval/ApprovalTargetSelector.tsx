/**
 * ApprovalTargetSelector — FR-003. Reusable requester-side control used by the
 * leave / overtime / business trip / permission create forms.
 *
 * The choices are ALWAYS backend-provided (GET /approval-targets?type=...);
 * the backend re-validates eligibility at submission. The component only ever
 * displays backend-resolved role/user names — never raw ObjectIds.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type {
  ApprovalTargetType,
  ApprovalTargetValue,
} from "@contracts/approvals";

import { approvalTargetsApi } from "@/lib/axios";
import { Spinner } from "@/components/ui/Spinner";

export function ApprovalTargetSelector({
  type,
  value,
  onChange,
  allowRole = true,
}: {
  type: ApprovalTargetType;
  value: ApprovalTargetValue | null;
  onChange: (value: ApprovalTargetValue | null) => void;
  // FR-006: Business Trip / Leave / Sick / Permission no longer offer the Role
  // option; the backend auto-resolves the default eligible role when the
  // requester does not pick a specific user. Overtime keeps allowRole=true.
  allowRole?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["approval-targets", type],
    queryFn: () => approvalTargetsApi.list(type).then((r) => r.data.data),
  });

  const roles = useMemo(() => data?.roles ?? [], [data?.roles]);
  const users = useMemo(() => data?.users ?? [], [data?.users]);
  const hasTargets = roles.length > 0 || users.length > 0;

  const targetType = value?.targetType ?? (allowRole ? "ROLE" : "USER");
  const selectedRoleId = value?.targetRoleId ?? "";
  const selectedUserId = value?.targetUserId ?? "";

  // When role selection is disabled, never let a stale ROLE target survive —
  // the backend would otherwise treat it as an explicit (invalid) target.
  useEffect(() => {
    if (!allowRole && value?.targetType === "ROLE") {
      onChange(null);
    }
  }, [allowRole, value, onChange]);

  // Default to the first eligible target once options are available so the
  // form always submits a valid approval target.
  useEffect(() => {
    if (!data || value) return;
    if (allowRole && roles.length > 0) {
      onChange({ targetType: "ROLE", targetRoleId: roles[0].roleId });
    } else if (users.length > 0) {
      onChange({ targetType: "USER", targetUserId: users[0].userId });
    }
  }, [data, value, roles, users, onChange, allowRole]);

  function handleTargetType(next: "ROLE" | "USER") {
    if (next === "ROLE") {
      onChange({ targetType: "ROLE", targetRoleId: selectedRoleId || roles[0]?.roleId });
    } else {
      onChange({ targetType: "USER", targetUserId: selectedUserId || users[0]?.userId });
    }
  }

  const roleSelectionValid = selectedRoleId
    ? roles.some((r) => r.roleId === selectedRoleId)
    : false;
  const userSelectionValid = selectedUserId
    ? users.some((u) => u.userId === selectedUserId)
    : false;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <div>
        <h4 className="font-semibold">Approval Request</h4>
        <p className="text-sm text-slate-500">Siapa yang anda ingin untuk menyetujui permintaan ini?</p>
      </div>

      {isLoading ? (
        <Spinner label="Memuat approver yang tersedia..." className="py-4" />
      ) : isError ? (
        <p className="text-sm text-red-600">Gagal memuat daftar approver.</p>
      ) : !allowRole && users.length === 0 ? (
        // FR-006: without a specific user the backend resolves the default
        // eligible role automatically — the target may be omitted.
        <p className="text-sm text-slate-500">
          Penyetuju akan ditentukan otomatis sesuai konfigurasi.
        </p>
      ) : !hasTargets ? (
        <p className="text-sm text-slate-500">
          Tidak ada approver yang memenuhi syarat.
        </p>
      ) : (
        <>
          {allowRole ? (
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`approval-target-${type}`}
                  checked={targetType === "ROLE"}
                  disabled={roles.length === 0}
                  onChange={() => handleTargetType("ROLE")}
                  className="size-4 accent-slate-900"
                />
                Pilih Role
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`approval-target-${type}`}
                  checked={targetType === "USER"}
                  disabled={users.length === 0}
                  onChange={() => handleTargetType("USER")}
                  className="size-4 accent-slate-900"
                />
                Pilih Pengguna
              </label>
            </div>
          ) : (
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`approval-target-${type}`}
                  checked
                  disabled={users.length === 0}
                  className="size-4 accent-slate-900"
                  readOnly
                />
                Pilih Pengguna
              </label>
            </div>
          )}

          {targetType === "ROLE" ? (
            roles.length > 0 ? (
              <select
                value={roleSelectionValid ? selectedRoleId : ""}
                onChange={(e) =>
                  onChange({ targetType: "ROLE", targetRoleId: e.target.value })
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
              >
                <option value="">Pilih peran…</option>
                {roles.map((role) => (
                  <option key={role.roleId} value={role.roleId}>
                    {role.roleName} — Level {role.approvalLevel}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-500">Tidak ada peran yang memenuhi syarat.</p>
            )
          ) : users.length > 0 ? (
            <select
              value={userSelectionValid ? selectedUserId : ""}
              onChange={(e) =>
                onChange({ targetType: "USER", targetUserId: e.target.value })
              }
              className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            >
              <option value="">Pilih pengguna…</option>
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.userName} — {user.roleName}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">Tidak ada pengguna yang memenuhi syarat.</p>
          )}
        </>
      )}
    </div>
  );
}
