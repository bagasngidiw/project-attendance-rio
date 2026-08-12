/**
 * PermissionMatrix — module×permission checkbox grid for the selected role
 * (FR-011 §6 PermissionMatrixTable). Checkbox toggles are staged client-side
 * until Save via the change bar. SUPER_ADMIN protected cells are locked.
 */

import { Lock } from "lucide-react";

import type {
  AdminRoleDto,
  MatrixModuleDto,
} from "@contracts/rbac-admin";
import type { PermissionKey } from "@contracts/permissions";
import { PERMISSIONS } from "@contracts/permissions";

export function PermissionMatrix({
  modules,
  selectedRole,
  staged,
  canEdit,
  onToggle,
}: {
  modules: MatrixModuleDto[];
  selectedRole: AdminRoleDto;
  staged: Record<string, boolean>;
  canEdit: boolean;
  onToggle: (key: PermissionKey, value: boolean) => void;
}) {
  const currentGrants = new Set(selectedRole.permissions);

  return (
    <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="font-semibold">
          Izin — {selectedRole.name}
        </h3>
        <p className="text-xs text-slate-400">
          Aktifkan/nonaktifkan izin, lalu simpan melalui bilah perubahan. Proteksi
          sistem tetap diberlakukan di sisi server.
        </p>
      </div>

      <div className="max-h-[480px] overflow-auto">
        {modules.map((module) => (
          <div key={module.module} className="border-b border-slate-100 last:border-0">
            <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {module.module}
            </div>
            <ul className="divide-y divide-slate-50">
              {module.permissions.map((perm) => {
                const locked = isProtected(selectedRole, perm.key);
                const effective =
                  staged[perm.key] ?? currentGrants.has(perm.key);

                return (
                  <li key={perm.key} className="flex items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={effective}
                      disabled={!canEdit || locked}
                      onChange={(e) => onToggle(perm.key, e.target.checked)}
                      className="size-4 accent-slate-900 disabled:opacity-50"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-slate-700">{perm.key}</p>
                      <p className="text-xs text-slate-400 truncate">{perm.description}</p>
                    </div>
                    {locked ? (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                        title="Izin yang dilindungi platform"
                      >
                        <Lock size={12} />
                        Dilindungi
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Platform-protected permissions: a SUPER_ADMIN can never lose these through
 * the console (mirrors the backend `platform-admin` guard). Referenced via the
 * shared contract so the two surfaces stay in sync.
 */
const PROTECTED_PERMISSIONS: readonly string[] = [
  PERMISSIONS.RBAC_MANAGE_ROLES,
  PERMISSIONS.RBAC_MANAGE_PERMISSIONS,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.PLATFORM_SETTINGS,
];

function isProtected(role: AdminRoleDto, key: string) {
  return (
    role.key === "SUPER_ADMIN" && PROTECTED_PERMISSIONS.includes(key)
  );
}
