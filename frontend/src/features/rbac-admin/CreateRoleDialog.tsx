/**
 * CreateRoleDialog — thin wrapper around the FR-064 RoleWizard kept for
 * backwards compatibility. Fetches the wizard metadata and role list itself.
 */

import { useQuery } from "@tanstack/react-query";

import { rbacAdminApi } from "@/lib/axios";
import { RoleWizard } from "./RoleWizard";

export function CreateRoleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const metaQuery = useQuery({
    queryKey: ["rbac-admin-meta"],
    queryFn: () => rbacAdminApi.getMeta().then((r) => r.data.data ?? null),
  });
  const rolesQuery = useQuery({
    queryKey: ["rbac-admin-roles"],
    queryFn: () => rbacAdminApi.listRoles().then((r) => r.data.data ?? []),
  });

  return (
    <RoleWizard
      meta={metaQuery.data ?? null}
      roles={rolesQuery.data ?? []}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
