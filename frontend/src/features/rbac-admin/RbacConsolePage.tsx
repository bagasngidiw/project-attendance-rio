/**
 * RbacConsolePage — FR-011 Role & Permission Configuration Console.
 *
 * Three panels:
 *  1. RoleList — list/create/rename/enable/disable roles (system roles locked)
 *  2. PermissionMatrix — module×role checkbox grid with staged changes + Save
 *  3. EffectiveViewer — inspect any user's resolved permission set
 *
 * Guarded by `rbac:view_roles` at the router; write actions additionally
 * gated by `rbac:manage_*` via the Can component.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type {
  MatrixModuleDto,
} from "@contracts/rbac-admin";
import type { PermissionKey } from "@contracts/permissions";
import { PERMISSIONS } from "@contracts/permissions";

import { rbacAdminApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { usePermission } from "@/features/auth/usePermission";
import { Can } from "@/features/auth/Can";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";

import { RoleListPanel } from "./RoleListPanel";
import { PermissionMatrix } from "./PermissionMatrix";
import { EffectivePermissionViewer } from "./EffectivePermissionViewer";
import { RoleWizard } from "./RoleWizard";
import { PermissionChangeBar } from "./PermissionChangeBar";

export default function RbacConsolePage() {
  const { hasPermission } = usePermission();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [staged, setStaged] = useState<
    Record<string, Record<string, boolean>>
  >({});

  // Fetch roles + matrix in parallel.
  const rolesQuery = useQuery({
    queryKey: ["rbac-admin-roles"],
    queryFn: () => rbacAdminApi.listRoles().then((r) => r.data.data ?? []),
  });
  const matrixQuery = useQuery({
    queryKey: ["rbac-admin-matrix"],
    queryFn: () => rbacAdminApi.getMatrix().then((r) => r.data.data ?? { modules: [] }),
  });
  // FR-064: role wizard metadata (templates, checklist groups, level schema).
  const metaQuery = useQuery({
    queryKey: ["rbac-admin-meta"],
    queryFn: () => rbacAdminApi.getMeta().then((r) => r.data.data ?? null),
  });

  // Stable identities for dependency arrays.
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const modules = useMemo(
    () => matrixQuery.data?.modules ?? [],
    [matrixQuery.data]
  );

  // Default selection: first role (only when none selected yet). Derived in
  // render, so no effect is needed to initialize it.
  const effectiveSelectedRoleId =
    selectedRoleId ?? (roles.length > 0 ? roles[0].id : null);

  const selectedRole =
    roles.find((r) => r.id === effectiveSelectedRoleId) ?? null;

  // Build the staged-change diff (added/removed per role) from checkbox state.
  const pendingChanges = useMemo(
    () => computePendingChanges(staged, modules),
    [staged, modules]
  );

  const applyChanges = useCallback(
    async (reason: string) => {
      if (!effectiveSelectedRoleId) return;
      const role = roles.find((r) => r.id === effectiveSelectedRoleId);
      if (!role) return;

      try {
        const target = staged[effectiveSelectedRoleId] ?? {};
        const desiredPermissions = modules
          .flatMap((m) => m.permissions)
          .filter((perm) => target[perm.key] ?? false)
          .map((perm) => perm.key);

        const res = await rbacAdminApi.setPermissions(effectiveSelectedRoleId, {
          permissions: desiredPermissions,
          reason,
          expectedVersion: role.version,
        });
        toast.success(
          `Izin diperbarui untuk ${res.data.data?.affectedUsers ?? 0} pengguna.`
        );
        // Clear staged state for this role and refresh.
        setStaged((prev) => {
          const next = { ...prev };
          delete next[effectiveSelectedRoleId];
          return next;
        });
        rolesQuery.refetch();
        matrixQuery.refetch();
      } catch (err) {
        toast.error(apiErrorMessage(err) ?? "Gagal memperbarui izin. Muat ulang dan coba lagi.");
        matrixQuery.refetch();
        rolesQuery.refetch();
      }
    },
    [effectiveSelectedRoleId, roles, staged, modules, rolesQuery, matrixQuery]
  );

  if (rolesQuery.isLoading || matrixQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat konsol peran & izin..." />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Peran &amp; Izin</h2>
          <p className="text-sm text-slate-500">
            Kelola peran dan matriks izin. Perubahan berlaku segera
            untuk pengguna yang terdampak.
          </p>
          {selectedRole ? (
            <p className="mt-1 text-xs text-slate-500">
              Dipilih: <span className="font-medium text-slate-700">{selectedRole.name}</span>
              <span className="mx-1.5">·</span>
              Lv {selectedRole.level}
              {selectedRole.levelLabel ? ` · ${selectedRole.levelLabel}` : ""}
              <span className="mx-1.5">·</span>
              {selectedRole.dataScope}
            </p>
          ) : null}
        </div>
        <Can permission={PERMISSIONS.RBAC_MANAGE_ROLES}>
          <Button onClick={() => setShowCreate(true)}>Peran Baru</Button>
        </Can>
      </div>

      {rolesQuery.isError || matrixQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat konsol RBAC.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <RoleListPanel
            roles={roles}
            selectedRoleId={selectedRoleId}
            onSelect={setSelectedRoleId}
            onChanged={() => {
              rolesQuery.refetch();
              matrixQuery.refetch();
            }}
          />

          <div className="space-y-4">
            {selectedRole ? (
              <PermissionMatrix
                modules={modules}
                selectedRole={selectedRole}
                staged={staged[selectedRole.id] ?? {}}
                canEdit={hasPermission(PERMISSIONS.RBAC_MANAGE_PERMISSIONS)}
                onToggle={(key, value) =>
                  setStaged((prev) => ({
                    ...prev,
                    [selectedRole.id]: {
                      ...(prev[selectedRole.id] ?? {}),
                      [key]: value,
                    },
                  }))
                }
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
                Pilih peran untuk mengedit izinnya.
              </div>
            )}

            {selectedRoleId && pendingChanges.length > 0 ? (
              <PermissionChangeBar
                changes={pendingChanges}
                onApply={applyChanges}
              />
            ) : null}

            <EffectivePermissionViewer />
          </div>
        </div>
      )}

      {showCreate ? (
        <RoleWizard
          meta={metaQuery.data ?? null}
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            rolesQuery.refetch();
            matrixQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

/** Diff of staged changes across a role (for the change bar). */
function computePendingChanges(
  staged: Record<string, Record<string, boolean>>,
  modules: MatrixModuleDto[]
): Array<{ roleId: string; key: PermissionKey; added: boolean }> {
  const changes: Array<{ roleId: string; key: PermissionKey; added: boolean }> = [];
  for (const [roleId, perms] of Object.entries(staged)) {
    for (const [key, value] of Object.entries(perms)) {
      changes.push({ roleId, key: key as PermissionKey, added: value });
    }
  }
  void modules; // modules used for key enumeration in the parent; kept for parity
  return changes;
}
