import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Plus, Save, Trash2 } from "lucide-react";

import type {
  HierarchyDto,
  HierarchyNodeDto,
  HierarchyRelation,
  HierarchyUserDto,
} from "@contracts/hierarchy";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { apiErrorMessage } from "@/lib/apiError";
import { hierarchyApi, contractTypeApi, placementApi } from "@/lib/axios";
import { toast } from "@/lib/toast";

type InsertAction = {
  anchorNodeId: string | null;
  relation: HierarchyRelation;
};

export default function HierarchyPage() {
  const [contractTypeId, setContractTypeId] = useState("");
  const [placementId, setPlacementId] = useState("");
  const [chart, setChart] = useState<HierarchyDto | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [insertAction, setInsertAction] = useState<InsertAction | null>(null);
  const [deleteNode, setDeleteNode] = useState<HierarchyNodeDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [listStatus, setListStatus] = useState("");
  const [busyChartId, setBusyChartId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const contractsQuery = useQuery({
    queryKey: ["hierarchy-contracts"],
    queryFn: () => contractTypeApi.list().then((response) => response.data.data ?? []),
  });

  const placementsQuery = useQuery({
    queryKey: ["hierarchy-placements", contractTypeId],
    queryFn: () => hierarchyApi.listPlacements(contractTypeId).then((response) => response.data.data ?? []),
    enabled: Boolean(contractTypeId),
  });

  const chartUsersQuery = useQuery({
    queryKey: ["hierarchy-chart-users", chart?.id],
    queryFn: () => hierarchyApi.eligibleUsers(chart!.id, "", true).then((response) => response.data.data ?? []),
    enabled: Boolean(chart?.id),
  });

  const selectedContract = useMemo(
    () => (contractsQuery.data ?? []).find((item) => item.id === contractTypeId),
    [contractsQuery.data, contractTypeId]
  );
  const selectedPlacement = useMemo(
    () => (placementsQuery.data ?? []).find((item) => item.id === placementId),
    [placementsQuery.data, placementId]
  );
  const usersById = useMemo(
    () => new Map((chartUsersQuery.data ?? []).map((user) => [user.userId, user])),
    [chartUsersQuery.data]
  );

  // -------------------------------------------------------------------------
  // Hierarchy list (track every chart that has been created)
  // -------------------------------------------------------------------------
  const hierarchyListQuery = useQuery({
    queryKey: ["hierarchy-list", listStatus],
    queryFn: () =>
      hierarchyApi
        .list(listStatus ? { status: listStatus } : undefined)
        .then((response) => response.data.data ?? []),
  });

  // Placement names for the table. `/placements` returns ACTIVE placements;
  // archived placements fall back to a short id in the cell.
  const allPlacementsQuery = useQuery({
    queryKey: ["hierarchy-all-placements"],
    queryFn: () => placementApi.list().then((response) => response.data.data ?? []),
  });

  const contractNames = useMemo(
    () => new Map((contractsQuery.data ?? []).map((item) => [item.id, item.name])),
    [contractsQuery.data]
  );
  const placementNames = useMemo(
    () => new Map((allPlacementsQuery.data ?? []).map((item) => [item.id, item.name])),
    [allPlacementsQuery.data]
  );

  async function refreshHierarchyList() {
    await queryClient.invalidateQueries({ queryKey: ["hierarchy-list"] });
  }

  function openChartFromList(item: HierarchyDto) {
    setContractTypeId(item.contractTypeId);
    setPlacementId(item.placementId);
    setChart(item);
  }

  async function activateFromList(item: HierarchyDto) {
    setBusyChartId(item.id);
    try {
      const response = await hierarchyApi.activate(item.id, item.version);
      const updated = response.data.data ?? item;
      if (chart?.id === item.id) setChart(updated);
      toast.success("Bagan hirarki diaktifkan.");
      await refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal mengaktifkan bagan.");
    } finally {
      setBusyChartId(null);
    }
  }

  async function archiveFromList(item: HierarchyDto) {
    setBusyChartId(item.id);
    try {
      const response = await hierarchyApi.archive(item.id, item.version);
      const updated = response.data.data ?? item;
      if (chart?.id === item.id) setChart(updated);
      toast.success("Bagan hirarki diarsipkan.");
      await refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal mengarsipkan bagan.");
    } finally {
      setBusyChartId(null);
    }
  }

  async function createOrLoadChart() {
    if (!contractTypeId || !placementId) return;
    setLoadingChart(true);
    try {
      const response = await hierarchyApi.create({ contractTypeId, placementId });
      setChart(response.data.data ?? null);
      toast.success("Bagan hirarki siap digunakan.");
      void refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal membuat bagan hirarki.");
    } finally {
      setLoadingChart(false);
    }
  }

  async function addNode(userId: string) {
    if (!chart || !insertAction) return;
    setSaving(true);
    try {
      const response = await hierarchyApi.addNode(chart.id, {
        userId,
        anchorNodeId: insertAction.anchorNodeId,
        relation: insertAction.relation,
        expectedVersion: chart.version,
      });
      setChart(response.data.data ?? chart);
      setInsertAction(null);
      toast.success("User ditambahkan ke bagan.");
      void refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal menambahkan user ke bagan.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNode(promoteChildren: boolean) {
    if (!chart || !deleteNode) return;
    setSaving(true);
    try {
      const response = await hierarchyApi.removeNode(chart.id, deleteNode.nodeId, {
        expectedVersion: chart.version,
        promoteChildren,
      });
      setChart(response.data.data ?? chart);
      setDeleteNode(null);
      toast.success("Node dihapus dari bagan.");
      void refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal menghapus node.");
    } finally {
      setSaving(false);
    }
  }

  async function activateChart() {
    if (!chart) return;
    setSaving(true);
    try {
      const response = await hierarchyApi.activate(chart.id, chart.version);
      setChart(response.data.data ?? chart);
      toast.success("Bagan hirarki diaktifkan.");
      void refreshHierarchyList();
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? "Gagal mengaktifkan bagan.");
    } finally {
      setSaving(false);
    }
  }

  function resetPlacement(nextContractId: string) {
    setContractTypeId(nextContractId);
    setPlacementId("");
    setChart(null);
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Network className="size-5 text-[var(--brand-primary)]" />
          <h2 className="text-xl font-bold">Bagan Hirarki</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Susun hubungan atasan dan bawahan berdasarkan kontrak serta penempatan.
        </p>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Daftar bagan: track every hierarchy chart that has been created.    */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Daftar Bagan Hirarki</h3>
            <p className="mt-1 text-xs text-slate-500">
              Semua bagan yang pernah dibuat, beserta status dan versinya.
            </p>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Status
            <select
              value={listStatus}
              onChange={(event) => setListStatus(event.target.value)}
              className="mt-1 h-10 w-44 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-slate-900 focus:outline-none"
            >
              <option value="">Semua status</option>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Aktif</option>
              <option value="ARCHIVED">Diarsipkan</option>
            </select>
          </label>
        </div>

        {hierarchyListQuery.isLoading ? (
          <Spinner label="Memuat daftar bagan..." className="py-6" />
        ) : hierarchyListQuery.isError ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Gagal memuat daftar bagan hirarki.
          </p>
        ) : (hierarchyListQuery.data ?? []).length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
            Belum ada bagan hirarki. Buat bagan pertama dengan memilih kontrak dan
            penempatan di bawah.
          </p>
        ) : (
          <div className="table-scroll overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kontrak</th>
                  <th className="px-4 py-3">Penempatan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Node</th>
                  <th className="px-4 py-3">Versi</th>
                  <th className="px-4 py-3">Diperbarui</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(hierarchyListQuery.data ?? []).map((item) => {
                  const busy = busyChartId === item.id;
                  const isOpen = chart?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={isOpen ? "bg-slate-50" : "hover:bg-slate-50"}
                    >
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        {contractNames.get(item.contractTypeId) ?? shortIdentifier(item.contractTypeId)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {placementNames.get(item.placementId) ?? shortIdentifier(item.placementId)}
                      </td>
                      <td className="px-4 py-3">
                        <HierarchyStatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {item.nodes.length}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {item.version}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatUpdatedAt(item.updatedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openChartFromList(item)}
                          >
                            Buka
                          </Button>
                          {item.status === "DRAFT" ? (
                            <Button
                              size="sm"
                              loading={busy}
                              disabled={busy || item.nodes.length === 0}
                              onClick={() => activateFromList(item)}
                            >
                              Aktifkan
                            </Button>
                          ) : null}
                          {item.status === "ACTIVE" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy}
                              disabled={busy}
                              onClick={() => archiveFromList(item)}
                            >
                              Arsipkan
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4">
          <div>
            <h3 className="font-semibold">Tentukan Scope</h3>
            <p className="mt-1 text-xs text-slate-500">Pilih kontrak dan penempatan sebelum membuat bagan.</p>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Kontrak
            <select
              value={contractTypeId}
              onChange={(event) => resetPlacement(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-slate-900 focus:outline-none"
            >
              <option value="">Pilih kontrak…</option>
              {(contractsQuery.data ?? []).map((contract) => (
                <option key={contract.id} value={contract.id}>{contract.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Penempatan
            <select
              value={placementId}
              onChange={(event) => { setPlacementId(event.target.value); setChart(null); }}
              disabled={!contractTypeId || placementsQuery.isLoading}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
            >
              <option value="">{placementsQuery.isLoading ? "Memuat…" : "Pilih penempatan…"}</option>
              {(placementsQuery.data ?? []).map((placement) => (
                <option key={placement.id} value={placement.id}>{placement.name}</option>
              ))}
            </select>
          </label>
          {placementsQuery.isError ? <p className="text-sm text-red-600">Gagal memuat penempatan.</p> : null}
          <Button
            className="w-full"
            onClick={createOrLoadChart}
            disabled={!contractTypeId || !placementId}
            loading={loadingChart}
          >
            <Network className="size-4" />
            Buat Bagan Hirarki
          </Button>
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4 sm:p-6">
          {!chart ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-slate-500">
              <Network className="mb-3 size-10 text-slate-300" />
              <p className="font-medium">Belum ada bagan yang dipilih</p>
              <p className="mt-1 max-w-md text-sm">Pilih kontrak dan penempatan untuk mulai menyusun struktur user.</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Kontrak: {selectedContract?.name ?? chart.contractTypeId}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Penempatan: {selectedPlacement?.name ?? chart.placementId}</span>
                    <span className={`rounded-full px-3 py-1 ${chart.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {chart.status === "ACTIVE" ? "Aktif" : "Draft"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Versi bagan: {chart.version}</p>
                </div>
                <div className="flex gap-2">
                  {chart.status === "DRAFT" ? (
                    <Button size="sm" onClick={activateChart} loading={saving} disabled={!chart.nodes.length}>
                      <Save className="size-4" /> Aktifkan
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => setInsertAction({ anchorNodeId: null, relation: "ROOT" })}>
                    <Plus className="size-4" /> Tambah Root
                  </Button>
                </div>
              </div>
              {chart.nodes.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 text-center text-slate-500">
                  <p className="font-medium">Bagan masih kosong</p>
                  <p className="mt-1 text-sm">Tambahkan user pertama sebagai jabatan paling atas.</p>
                  <Button className="mt-4" size="sm" onClick={() => setInsertAction({ anchorNodeId: null, relation: "ROOT" })}>
                    <Plus className="size-4" /> Tambah User Pertama
                  </Button>
                </div>
              ) : (
                <HierarchyTree
                  nodes={chart.nodes}
                  usersById={usersById}
                  onInsert={(action) => setInsertAction(action)}
                  onDelete={(node) => setDeleteNode(node)}
                />
              )}
            </>
          )}
        </div>
      </section>

      {insertAction ? (
        <NodeInsertDialog
          chart={chart}
          action={insertAction}
          saving={saving}
          onClose={() => setInsertAction(null)}
          onSubmit={addNode}
        />
      ) : null}
      {deleteNode ? (
        <DeleteNodeDialog
          chart={chart}
          node={deleteNode}
          saving={saving}
          onClose={() => setDeleteNode(null)}
          onDelete={removeNode}
        />
      ) : null}
    </div>
  );
}

function HierarchyTree({
  nodes,
  usersById,
  onInsert,
  onDelete,
}: {
  nodes: HierarchyNodeDto[];
  usersById: Map<string, HierarchyUserDto>;
  onInsert: (action: InsertAction) => void;
  onDelete: (node: HierarchyNodeDto) => void;
}) {
  const childrenByParent = useMemo(() => {
    const result = new Map<string, HierarchyNodeDto[]>();
    nodes.forEach((node) => {
      const key = node.parentNodeId ?? "ROOT";
      const current = result.get(key) ?? [];
      current.push(node);
      result.set(key, current);
    });
    result.forEach((children) => children.sort((a, b) => a.sortOrder - b.sortOrder));
    return result;
  }, [nodes]);

  const roots = childrenByParent.get("ROOT") ?? [];
  return (
    <div className="min-w-max overflow-x-auto pb-4">
      <div className="flex items-start justify-center gap-8 px-4">
        {roots.map((node) => (
          <TreeBranch
            key={node.nodeId}
            node={node}
            childrenByParent={childrenByParent}
            user={usersById.get(node.userId)}
            usersById={usersById}
            onInsert={onInsert}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

function TreeBranch({
  node,
  childrenByParent,
  user,
  usersById,
  onInsert,
  onDelete,
}: {
  node: HierarchyNodeDto;
  childrenByParent: Map<string, HierarchyNodeDto[]>;
  user?: HierarchyUserDto;
  usersById: Map<string, HierarchyUserDto>;
  onInsert: (action: InsertAction) => void;
  onDelete: (node: HierarchyNodeDto) => void;
}) {
  const children = childrenByParent.get(node.nodeId) ?? [];
  return (
    <div className="flex flex-col items-center">
      <HierarchyNodeCard node={node} user={user} onInsert={onInsert} onDelete={onDelete} />
      {children.length > 0 ? (
        <>
          <div className="h-6 w-px bg-slate-300" />
          <div className="flex items-start gap-6 border-t border-slate-300 px-4 pt-4">
            {children.map((child) => (
              <TreeBranch
                key={child.nodeId}
                node={child}
                childrenByParent={childrenByParent}
                user={usersById.get(child.userId)}
                usersById={usersById}
                onInsert={onInsert}
                onDelete={onDelete}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function HierarchyNodeCard({
  node,
  user,
  onInsert,
  onDelete,
}: {
  node: HierarchyNodeDto;
  user?: HierarchyUserDto;
  onInsert: (action: InsertAction) => void;
  onDelete: (node: HierarchyNodeDto) => void;
}) {
  const initials = (user?.userName ?? "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="relative w-64 rounded-xl border-2 border-slate-200 bg-white p-4 shadow-sm">
      <NodeActionButton label="Tambah atasan" className="-top-3 left-1/2 -translate-x-1/2" onClick={() => onInsert({ anchorNodeId: node.nodeId, relation: "PARENT" })}>
        ↑
      </NodeActionButton>
      <NodeActionButton label="Tambah sejajar kiri" className="-left-3 top-1/2 -translate-y-1/2" onClick={() => onInsert({ anchorNodeId: node.nodeId, relation: "SIBLING_BEFORE" })}>
        ←
      </NodeActionButton>
      <NodeActionButton label="Tambah sejajar kanan" className="-right-3 top-1/2 -translate-y-1/2" onClick={() => onInsert({ anchorNodeId: node.nodeId, relation: "SIBLING_AFTER" })}>
        →
      </NodeActionButton>
      <NodeActionButton label="Tambah bawahan" className="-bottom-3 left-1/2 -translate-x-1/2" onClick={() => onInsert({ anchorNodeId: node.nodeId, relation: "CHILD" })}>
        ↓
      </NodeActionButton>
      <button
        type="button"
        aria-label="Hapus node"
        onClick={() => onDelete(node)}
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="size-4" />
      </button>
      <div className="flex items-center gap-3 pr-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{initials}</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{user?.userName ?? "User tidak ditemukan"}</p>
          <p className="truncate text-xs text-slate-500">{user?.username ?? node.userId}</p>
        </div>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
        <p>{user?.nip ? `NIP: ${user.nip}` : "NIP belum tersedia"}</p>
        <p className="mt-1 truncate">{user?.roleNames.length ? user.roleNames.join(", ") : "Role belum tersedia"}</p>
      </div>
    </div>
  );
}

function NodeActionButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`absolute z-10 flex size-6 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-600 shadow-sm hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] ${className}`}
    >
      {children}
    </button>
  );
}

function NodeInsertDialog({
  chart,
  action,
  saving,
  onClose,
  onSubmit,
}: {
  chart: HierarchyDto | null;
  action: InsertAction;
  saving: boolean;
  onClose: () => void;
  onSubmit: (userId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const usersQuery = useQuery({
    queryKey: ["hierarchy-eligible-users", chart?.id, search],
    queryFn: () => hierarchyApi.eligibleUsers(chart!.id, search).then((response) => response.data.data ?? []),
    enabled: Boolean(chart?.id),
  });
  const relationLabels: Record<HierarchyRelation, string> = {
    ROOT: "User paling atas",
    PARENT: "Atasan baru",
    CHILD: "Bawahan baru",
    SIBLING_BEFORE: "User sejajar di kiri",
    SIBLING_AFTER: "User sejajar di kanan",
  };
  return (
    <Modal title={`Tambah ${relationLabels[action.relation]}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Pilih user aktif yang belum ada di bagan ini.</p>
        <Input label="Cari nama user" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nama, username, atau NIP" autoFocus />
        {usersQuery.isLoading ? <Spinner label="Memuat user…" className="py-4" /> : null}
        {usersQuery.isError ? <p className="text-sm text-red-600">Gagal memuat user.</p> : null}
        {!usersQuery.isLoading && !usersQuery.isError && !(usersQuery.data ?? []).length ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Tidak ada user yang tersedia.</p> : null}
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {(usersQuery.data ?? []).map((user) => (
            <button
              key={user.userId}
              type="button"
              onClick={() => setSelectedUserId(user.userId)}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedUserId === user.userId ? "border-[var(--brand-primary)] bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <p className="text-sm font-semibold">{user.userName}</p>
              <p className="text-xs text-slate-500">{user.username}{user.nip ? ` · ${user.nip}` : ""}</p>
              <p className="mt-1 text-xs text-slate-500">{user.roleNames.length ? user.roleNames.join(", ") : "Role belum tersedia"}</p>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={() => onSubmit(selectedUserId)} disabled={!selectedUserId} loading={saving}>Tambahkan</Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteNodeDialog({
  chart,
  node,
  saving,
  onClose,
  onDelete,
}: {
  chart: HierarchyDto | null;
  node: HierarchyNodeDto;
  saving: boolean;
  onClose: () => void;
  onDelete: (promoteChildren: boolean) => void;
}) {
  const hasChildren = Boolean(chart?.nodes.some((item) => item.parentNodeId === node.nodeId));
  return (
    <Modal title="Hapus node hirarki" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {hasChildren
            ? "Node ini memiliki bawahan. Jika dilanjutkan, seluruh bawahannya akan dipindahkan ke parent node ini."
            : "Node ini akan dihapus dari bagan. Tindakan ini tercatat pada riwayat hirarki."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button variant="danger" onClick={() => onDelete(hasChildren)} loading={saving}>Hapus Node</Button>
        </div>
      </div>
    </Modal>
  );
}

const HIERARCHY_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-600",
};

const HIERARCHY_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Aktif",
  ARCHIVED: "Diarsipkan",
};

function HierarchyStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        HIERARCHY_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {HIERARCHY_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Last-6 fallback when a master record is archived and no longer listed. */
function shortIdentifier(value: string): string {
  return value ? `#${value.slice(-6)}` : "—";
}

function formatUpdatedAt(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
