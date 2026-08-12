/**
 * RoleListPanel — list of roles with create/rename/disable/enable actions
 * (FR-011 §6). System roles are locked; write actions gated by rbac:manage_roles.
 */

import { useState } from "react";
import { Lock, Power } from "lucide-react";

import type { AdminRoleDto } from "@contracts/rbac-admin";
import { PERMISSIONS } from "@contracts/permissions";

import { rbacAdminApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Can } from "@/features/auth/Can";
import { Button } from "@/components/ui/Button";
import { RenameRoleDialog } from "./RenameRoleDialog";

export function RoleListPanel({
  roles,
  selectedRoleId,
  onSelect,
  onChanged,
}: {
  roles: AdminRoleDto[];
  selectedRoleId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState<AdminRoleDto | null>(null);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  async function toggleStatus(role: AdminRoleDto) {
    setBusyRole(role.id);
    try {
      if (role.status === "ACTIVE") {
        await rbacAdminApi.disableRole(role.id, {
          expectedVersion: role.version,
        });
        toast.info(`Peran "${role.name}" dinonaktifkan.`);
      } else {
        await rbacAdminApi.enableRole(role.id, {
          expectedVersion: role.version,
        });
        toast.success(`Peran "${role.name}" diaktifkan.`);
      }
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Aksi gagal. Peran mungkin telah berubah — memuat ulang.");
      onChanged();
    } finally {
      setBusyRole(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="font-semibold">Peran</h3>
      </div>

      <ul className="divide-y divide-slate-100">
        {roles.map((role) => {
          const selected = role.id === selectedRoleId;
          const disabled = role.status === "DISABLED";

          return (
            <li key={role.id}>
              <div
                className={`flex cursor-pointer items-center gap-2 px-4 py-3 hover:bg-slate-50 ${
                  selected ? "bg-slate-50" : ""
                }`}
                onClick={() => onSelect(role.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {role.isSystem ? (
                      <Lock size={14} className="shrink-0 text-slate-400" aria-label="Peran sistem" />
                    ) : null}
                    <span className="font-medium truncate">{role.name}</span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{role.key}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      Lv {role.level}
                    </span>
                    <span
                      className="rounded bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500"
                      title={`Lingkup data: ${role.dataScope}`}
                    >
                      {role.dataScope}
                    </span>
                  </div>
                </div>

                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    disabled
                      ? "bg-red-50 text-red-600"
                      : "bg-green-50 text-green-700"
                  }`}
                >
                  {role.status}
                </span>
              </div>

              <Can permission={PERMISSIONS.RBAC_MANAGE_ROLES}>
                <div className="flex gap-2 px-4 pb-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={role.isSystem}
                    title={role.isSystem ? "Peran sistem tidak dapat diganti namanya" : "Ganti nama peran"}
                    onClick={() => setRenaming(role)}
                  >
                    Ganti nama
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyRole === role.id}
                    disabled={role.isSystem}
                    title={role.isSystem ? "Peran sistem tidak dapat dinonaktifkan" : role.status === "ACTIVE" ? "Nonaktifkan peran" : "Aktifkan peran"}
                    onClick={() => toggleStatus(role)}
                  >
                    <Power size={14} />
                    {role.status === "ACTIVE" ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </div>
              </Can>
            </li>
          );
        })}
      </ul>

      {renaming ? (
        <RenameRoleDialog
          role={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
