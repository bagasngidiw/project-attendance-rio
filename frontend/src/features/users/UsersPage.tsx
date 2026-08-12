/**
 * UsersPage — the FR-029 user administration console: paginated, searchable,
 * filterable list with role-based action gating (FR-023 pattern).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PERMISSIONS } from "@contracts/permissions";

import { usersApi } from "@/lib/axios";
import { userStatusLabel } from "@/lib/labels";
import { Can } from "@/features/auth/Can";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import type { UserListItem } from "./types";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { DeactivateConfirmDialog } from "./DeactivateConfirmDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

const PAGE_SIZE = 10;

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [deactivating, setDeactivating] = useState<UserListItem | null>(null);
  const [resetting, setResetting] = useState<UserListItem | null>(null);

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", params],
    queryFn: () => usersApi.list(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetAndRefetch() {
    setPage(1);
    refetch();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Pengguna</h2>
          <p className="text-sm text-slate-500">
            Sediakan dan kelola akun pengguna.
          </p>
        </div>
        <Can permission={PERMISSIONS.USERS_CREATE}>
          <Button onClick={() => setShowCreate(true)}>Pengguna Baru</Button>
        </Can>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          resetAndRefetch();
        }}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4"
      >
        <div className="w-full sm:w-64">
          <Input
            label="Cari"
            placeholder="Nama, nama pengguna, atau email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Nonaktif</option>
            <option value="PENDING">Menunggu</option>
          </select>
        </div>
        <Button type="submit" size="md">
          Cari
        </Button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat pengguna..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat pengguna.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Tidak ada pengguna yang sesuai dengan filter saat ini.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Nama pengguna</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Departemen</th>
                  <th className="px-4 py-3">Jabatan</th>
                  <th className="px-4 py-3">Manajer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Peran</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{user.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{user.username}</td>
                    <td className="px-4 py-3 text-slate-600">{user.email}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {user.departmentName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {user.positionName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {user.managerName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} mustChange={user.mustChangePassword} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <span
                            key={role}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Can permission={PERMISSIONS.USERS_EDIT}>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(user)}>
                            Edit
                          </Button>
                        </Can>
                        {user.status === "ACTIVE" ? (
                          <>
                            <Can permission={PERMISSIONS.USERS_DEACTIVATE}>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setDeactivating(user)}
                              >
                                Nonaktifkan
                              </Button>
                            </Can>
                            <Can permission={PERMISSIONS.USERS_RESET_PASSWORD}>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setResetting(user)}
                              >
                                Reset
                              </Button>
                            </Can>
                          </>
                        ) : (
                          <Can permission={PERMISSIONS.USERS_EDIT}>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={async () => {
                                await usersApi.activate(user.id);
                                refetch();
                              }}
                            >
                              Aktifkan
                            </Button>
                          </Can>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} pengguna</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Sebelumnya
              </button>
              <span>
                Halaman {page} dari {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}

      {showCreate ? (
        <CreateUserDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refetch(); }} />
      ) : null}
      {editing ? (
        <EditUserDialog user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refetch(); }} />
      ) : null}
      {deactivating ? (
        <DeactivateConfirmDialog user={deactivating} onClose={() => setDeactivating(null)} onSaved={() => { setDeactivating(null); refetch(); }} />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog userId={resetting.id} username={resetting.username} onClose={() => setResetting(null)} onSaved={() => { setResetting(null); refetch(); }} />
      ) : null}
    </div>
  );
}

function StatusBadge({
  status,
  mustChange,
}: {
  status: UserListItem["status"];
  mustChange: boolean;
}) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-green-50 text-green-700",
    INACTIVE: "bg-red-50 text-red-600",
    PENDING: "bg-amber-50 text-amber-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>
      {userStatusLabel(status)}
      {status === "ACTIVE" && mustChange ? " · wajib ganti kata sandi" : ""}
    </span>
  );
}
