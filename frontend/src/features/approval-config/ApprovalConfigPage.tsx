/**
 * ApprovalConfigPage (FR-001) — Superadmin surface for the approval
 * configuration: for each request type (Cuti / Lembur / Perjalanan Dinas /
 * Ijin) the eligible roles, their numeric approval level, whether they may
 * approve, whether they may be selected as a target, and the self-approval
 * toggle. Roles always come from the RBAC database — never hardcoded.
 *
 * Guarded by `approval_config:manage` at the router.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type {
  ApprovalConfigurationDto,
  ApprovalRequestType,
  ApprovalConfigurationRoleDto,
} from "@contracts/approvals";
import type { AdminRoleDto } from "@contracts/rbac-admin";

import { approvalConfigApi, rbacAdminApi } from "@/lib/axios";
import { toast } from "@/lib/toast";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";

const REQUEST_TYPES: Array<{ type: ApprovalRequestType; label: string }> = [
  { type: "LEAVE", label: "Cuti" },
  { type: "OVERTIME", label: "Lembur" },
  { type: "TRIP", label: "Perjalanan Dinas" },
  { type: "PERMISSION", label: "Ijin" },
  { type: "SAKIT", label: "Sakit" },
];

export function ApprovalConfigPage() {
  const configsQuery = useQuery({
    queryKey: ["approval-configs"],
    queryFn: () => approvalConfigApi.list().then((r) => r.data.data ?? []),
  });
  const rolesQuery = useQuery({
    queryKey: ["rbac-admin-roles"],
    queryFn: () => rbacAdminApi.listRoles().then((r) => r.data.data ?? []),
  });

  const configs = useMemo(
    () => (configsQuery.data ?? []).map((c) => ({ ...c, roles: [...c.roles] })),
    [configsQuery.data]
  );
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  if (configsQuery.isLoading || rolesQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat konfigurasi persetujuan..." />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Konfigurasi Persetujuan</h2>
        <p className="text-sm text-slate-500">
          Tentukan peran mana yang dapat menyetujui setiap jenis permintaan,
          level persetujuannya, dan apakah peran tersebut dapat dipilih sebagai
          target oleh pemohon.
        </p>
      </div>

      {configsQuery.isError || rolesQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat konfigurasi.
        </div>
      ) : (
        <div className="space-y-6">
          {REQUEST_TYPES.map(({ type, label }) => {
            const config = configs.find((c) => c.requestType === type);
            return (
              <ConfigSection
                key={type}
                requestType={type}
                label={label}
                config={config}
                roles={roles}
                onSaved={() => configsQuery.refetch()}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfigSection({
  requestType,
  label,
  config,
  roles,
  onSaved,
}: {
  requestType: ApprovalRequestType;
  label: string;
  config?: ApprovalConfigurationDto;
  roles: AdminRoleDto[];
  onSaved: () => void;
}) {
  const [entries, setEntries] = useState<ApprovalConfigurationRoleDto[]>(
    () => config?.roles.map((r) => ({ ...r })) ?? []
  );
  const [selfApproval, setSelfApproval] = useState(config?.selfApproval === true);
  const [addingRoleId, setAddingRoleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configuredIds = new Set(entries.map((e) => String(e.roleId)));
  const addableRoles = roles.filter(
    (r) => r.status === "ACTIVE" && !configuredIds.has(String(r.id))
  );

  function addRole(roleId: string) {
    if (!roleId) return;
    setEntries((prev) => [
      ...prev,
      { roleId, approvalLevel: 0, canApprove: false, canBeTarget: false },
    ]);
    setAddingRoleId("");
  }

  function updateEntry(roleId: string, patch: Partial<ApprovalConfigurationRoleDto>) {
    setEntries((prev) =>
      prev.map((e) => (String(e.roleId) === String(roleId) ? { ...e, ...patch } : e))
    );
  }

  function removeEntry(roleId: string) {
    setEntries((prev) => prev.filter((e) => String(e.roleId) !== String(roleId)));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await approvalConfigApi.update(requestType, {
        roles: entries,
        selfApproval,
        expectedVersion: config?.version ?? 1,
      });
      toast.success(`Konfigurasi ${label} disimpan.`);
      onSaved();
    } catch {
      setError(
        "Konfigurasi tidak dapat disimpan. Mungkin telah diubah admin lain — muat ulang lalu coba lagi."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="font-semibold">{label}</h3>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={selfApproval}
            onChange={(e) => setSelfApproval(e.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          Izinkan persetujuan diri sendiri
        </label>
      </header>

      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Peran</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Dapat menyetujui</th>
              <th className="px-4 py-3">Dapat dipilih target</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const role = roles.find((r) => String(r.id) === String(entry.roleId));
              return (
                <tr key={String(entry.roleId)} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    {role?.name ?? entry.roleId}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      {role?.key ?? "?"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      value={entry.approvalLevel}
                      onChange={(e) =>
                        updateEntry(entry.roleId, { approvalLevel: Number(e.target.value) })
                      }
                      className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={entry.canApprove}
                      onChange={(e) =>
                        updateEntry(entry.roleId, {
                          canApprove: e.target.checked,
                          canBeTarget: e.target.checked ? entry.canBeTarget : false,
                        })
                      }
                      className="size-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={entry.canBeTarget}
                      disabled={!entry.canApprove}
                      onChange={(e) => updateEntry(entry.roleId, { canBeTarget: e.target.checked })}
                      className="size-4 rounded border-slate-300 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => removeEntry(entry.roleId)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                  Belum ada peran yang dikonfigurasi.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center gap-3 border-t border-slate-100 px-4 py-3">
        <select
          value={addingRoleId}
          onChange={(e) => setAddingRoleId(e.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tambah peran...</option>
          {addableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={!addingRoleId} onClick={() => addRole(addingRoleId)}>
          Tambah
        </Button>

        {error ? (
          <span className="text-sm text-red-600">{error}</span>
        ) : null}

        <div className="ml-auto">
          <Button onClick={save} loading={saving}>
            Simpan
          </Button>
        </div>
      </footer>
    </section>
  );
}
