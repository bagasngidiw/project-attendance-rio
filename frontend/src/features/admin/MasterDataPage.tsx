/**
 * MasterDataPage — Superadmin master data for Cuti types, Sakit types,
 * Kontrak (contract types) and Penempatan (placements) (FR-058 / TODO.md §5 /
 * NEW UPDATE TAD SIMBIKA). Guarded by `platform:settings`. Changes are
 * validated, persisted, and audited (SETTINGS.CHANGED) by the backend.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  contractTypeAdminApi,
  leaveTypeAdminApi,
  placementAdminApi,
  sicknessTypeAdminApi,
} from "@/lib/axios";
import { MasterDataPanel, type MasterItem, type MasterCreatePayload } from "./MasterDataPanel";

type MasterTab = "leave" | "sickness" | "contract" | "placement";

const TABS: Array<{ key: MasterTab; label: string }> = [
  { key: "leave", label: "Tipe Cuti" },
  { key: "sickness", label: "Tipe Sakit" },
  { key: "contract", label: "Kontrak" },
  { key: "placement", label: "Penempatan" },
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
  const contractQuery = useQuery({
    queryKey: ["admin-contract-types"],
    queryFn: () => contractTypeAdminApi.list().then((r) => r.data.data ?? []),
  });
  const placementQuery = useQuery({
    queryKey: ["admin-placements"],
    queryFn: () => placementAdminApi.list().then((r) => r.data.data ?? []),
  });

  function invalidateLeave() {
    queryClient.invalidateQueries({ queryKey: ["admin-leave-types"] });
  }
  function invalidateSickness() {
    queryClient.invalidateQueries({ queryKey: ["admin-sickness-types"] });
  }
  function invalidateContract() {
    queryClient.invalidateQueries({ queryKey: ["admin-contract-types"] });
  }
  function invalidatePlacement() {
    queryClient.invalidateQueries({ queryKey: ["admin-placements"] });
  }

  async function createLeave(payload: MasterCreatePayload) {
    await leaveTypeAdminApi.create(payload);
    invalidateLeave();
  }
  async function createSickness(payload: MasterCreatePayload) {
    await sicknessTypeAdminApi.create(payload);
    invalidateSickness();
  }
  async function createContract(payload: MasterCreatePayload) {
    await contractTypeAdminApi.create(payload);
    invalidateContract();
  }
  async function createPlacement(payload: MasterCreatePayload) {
    await placementAdminApi.create(payload);
    invalidatePlacement();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">Master Data</h2>
        <p className="text-sm text-slate-500">
          Kelola daftar tipe cuti, tipe sakit, kontrak, dan penempatan. Usulan
          "Tambahkan sendiri" dari karyawan muncul dengan status menunggu
          aktivasi.
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
      ) : tab === "sickness" ? (
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
      ) : tab === "contract" ? (
        <MasterDataPanel
          title="Kontrak"
          description="Jenis kontrak yang tersedia untuk pengguna (NIP / kontrak kerja)."
          items={(contractQuery.data ?? []) as MasterItem[]}
          loading={contractQuery.isLoading}
          error={contractQuery.isError}
          onCreate={createContract}
          onActivate={async (id) => {
            await contractTypeAdminApi.activate(id);
            invalidateContract();
          }}
          onDeactivate={async (id) => {
            await contractTypeAdminApi.deactivate(id);
            invalidateContract();
          }}
        />
      ) : (
        <MasterDataPanel
          title="Penempatan"
          description="Penempatan kerja yang tersedia untuk pengguna."
          items={(placementQuery.data ?? []) as MasterItem[]}
          loading={placementQuery.isLoading}
          error={placementQuery.isError}
          onCreate={createPlacement}
          onActivate={async (id) => {
            await placementAdminApi.activate(id);
            invalidatePlacement();
          }}
          onDeactivate={async (id) => {
            await placementAdminApi.deactivate(id);
            invalidatePlacement();
          }}
        />
      )}
    </div>
  );
}
