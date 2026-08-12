/**
 * EffectivePermissionViewer — inspect any user's resolved permission set with
 * per-role breakdown (FR-011 §4.3). Requires rbac:view_permissions.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { rbacAdminApi } from "@/lib/axios";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export function EffectivePermissionViewer() {
  const [userId, setUserId] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["rbac-effective", submitted],
    queryFn: () =>
      rbacAdminApi
        .getEffectivePermissions(submitted as string)
        .then((r) => r.data.data),
    enabled: Boolean(submitted),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="font-semibold">Penampil Izin Efektif</h3>
        <p className="text-xs text-slate-400">
          Masukkan ID pengguna untuk melihat set izin yang telah diselesaikan.
        </p>
      </div>

      <div className="p-4">
        <div className="flex gap-2">
          <Input
            placeholder="ID pengguna"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => setSubmitted(userId.trim())}
            disabled={!userId.trim()}
          >
            Periksa
          </Button>
        </div>

        {query.isLoading ? (
          <div className="mt-4 flex justify-center py-6">
            <Spinner label="Menyelesaikan izin..." />
          </div>
        ) : query.isError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Tidak dapat menyelesaikan pengguna ini. Periksa ID dan coba lagi.
          </div>
        ) : query.data ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm text-slate-500">
                {query.data.username} — peran:{" "}
                <span className="font-medium text-slate-700">
                  {query.data.roles.join(", ") || "tidak ada"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {query.data.permissions.length} izin efektif
              </p>
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rincian per peran
              </h4>
              <div className="space-y-3">
                {query.data.breakdown.map((b) => (
                  <div key={b.roleId}>
                    <p className="text-xs font-medium text-slate-600">{b.roleKey}</p>
                    <p className="font-mono text-xs text-slate-500">
                      {b.permissions.join(", ")}
                    </p>
                  </div>
                ))}
                {query.data.breakdown.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Tidak ada peran AKTIF yang ditetapkan.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
