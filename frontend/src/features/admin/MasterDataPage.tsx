/**
 * MasterDataPage — Superadmin master data for Cuti types and Sakit types
 * (FR-058 / TODO.md §5). Guarded by `platform:settings`. Changes are
 * validated, persisted, and audited (SETTINGS.CHANGED) by the backend.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { leaveTypeAdminApi, sicknessTypeAdminApi } from "@/lib/axios";
import { MasterDataPanel, type MasterItem, type MasterCreatePayload } from "./MasterDataPanel";

type MasterTab = "leave" | "sickness";

const TABS: Array<{ key: MasterTab; label: string }> = [
  { key: "leave", label: "Tipe Cuti" },
  { key: "sickness", label: "Tipe Sakit" },
];

export function MasterDataPage() {
  const [tab, setTab] = useState<MasterTab>("leave");
  const queryClient = useQueryClient();

  const leaveQuery = useQuery({
    queryKey: ["admin-leave-types"],
    queryFn: () => leaveTypeAdminApi.list().then((r) => r.data.data?.items ?? []),
  });
  const sicknessQuery = useQuery({
    queryKey: ["admin-sickness-types"],
    queryFn: () => sicknessTypeAdminApi.list().then((r) => r.data.data ?? []),
  });

  function invalidateLeave() {
    queryClient.invalidateQueries({ queryKey: ["admin-leave-types"] });
  }
  function invalidateSickness() {
    queryClient.invalidateQueries({ queryKey: ["admin-sickness-types"] });
  }

  async function createLeave(payload: MasterCreatePayload) {
    await leaveTypeAdminApi.create(payload);
    invalidateLeave();
  }
  async function createSickness(payload: MasterCreatePayload) {
    await sicknessTypeAdminApi.create(payload);
    invalidateSickness();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">Master Data</h2>
        <p className="text-sm text-slate-500">
          Kelola daftar tipe cuti dan tipe sakit. Usulan "Tambahkan sendiri"
          dari karyawan muncul dengan status menunggu aktivasi.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-[var(--brand-primary)] text-[var(--brand-on-primary)]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "leave" ? (
        <MasterDataPanel
          title="Tipe Cuti"
          description="Jenis cuti yang tersedia pada form permintaan cuti."
          items={(leaveQuery.data ?? []) as MasterItem[]}
          loading={leaveQuery.isLoading}
          error={leaveQuery.isError}
          showBalanceFields
          onCreate={createLeave}
          onActivate={async (id) => {
            await leaveTypeAdminApi.activate(id);
            invalidateLeave();
          }}
          onDeactivate={async (id) => {
            await leaveTypeAdminApi.deactivate(id);
            invalidateLeave();
          }}
        />
      ) : (
        <MasterDataPanel
          title="Tipe Sakit"
          description="Jenis sakit yang tersedia pada form permintaan sakit."
          items={(sicknessQuery.data ?? []) as MasterItem[]}
          loading={sicknessQuery.isLoading}
          error={sicknessQuery.isError}
          onCreate={createSickness}
          onActivate={async (id) => {
            await sicknessTypeAdminApi.activate(id);
            invalidateSickness();
          }}
          onDeactivate={async (id) => {
            await sicknessTypeAdminApi.deactivate(id);
            invalidateSickness();
          }}
        />
      )}
    </div>
  );
}
