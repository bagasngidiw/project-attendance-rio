/**
 * PermissionChecklist — role wizard step 4: grouped, expandable permission
 * checklist with per-group select-all/clear, a key search filter and global
 * select-all/clear-all (FR-064).
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ChecklistGroupDto } from "@contracts/rbac-admin";
import type { PermissionKey } from "@contracts/permissions";

export function PermissionChecklist({
  groups,
  selected,
  onToggle,
  onToggleGroup,
  onSelectAll,
  onClearAll,
}: {
  groups: ChecklistGroupDto[];
  selected: ReadonlySet<PermissionKey>;
  onToggle: (key: PermissionKey, checked: boolean) => void;
  onToggleGroup: (keys: readonly PermissionKey[], checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.key))
  );

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter(
          (p) =>
            p.key.toLowerCase().includes(term) ||
            p.description.toLowerCase().includes(term)
        ),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, search]);

  const totalKeys = useMemo(
    () => groups.flatMap((g) => g.permissions.map((p) => p.key)),
    [groups]
  );

  const allSelected = totalKeys.length > 0 && totalKeys.every((k) => selected.has(k));

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">
          Izin awal
          <span className="ml-2 text-xs font-normal text-slate-400">
            {selected.size} dari {totalKeys.length} dipilih
          </span>
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Pilih semua
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Bersihkan semua
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Cari izin…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />

      <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
        {visibleGroups.map((group) => {
          const groupKeys = group.permissions.map((p) => p.key);
          const groupSelected = groupKeys.filter((k) => selected.has(k)).length;
          const isOpen = expanded.has(group.key);

          return (
            <div key={group.key} className="rounded-lg border border-slate-100">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isOpen}
                  className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium text-slate-700 hover:text-slate-900"
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-slate-400" />
                  )}
                  <span>{group.label}</span>
                  <span className="text-xs font-normal text-slate-400">
                    {groupSelected}/{group.permissions.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleGroup(groupKeys, groupSelected !== groupKeys.length)}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  {groupSelected === groupKeys.length && groupKeys.length > 0 ? "Bersihkan" : "Pilih semua"}
                </button>
              </div>

              {isOpen ? (
                <ul className="border-t border-slate-100">
                  {group.permissions.map((perm) => {
                    const checked = selected.has(perm.key);
                    return (
                      <li key={perm.key}>
                        <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onToggle(perm.key, e.target.checked)}
                            className="mt-0.5 size-4 accent-slate-900"
                          />
                          <span className="min-w-0">
                            <span className="block font-mono text-xs text-slate-700">
                              {perm.key}
                            </span>
                            <span className="block text-xs text-slate-400">
                              {perm.description}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}

        {visibleGroups.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-slate-400">
            Tidak ada izin yang cocok dengan “{search}”.
          </p>
        ) : null}

        {allSelected ? (
          <p className="px-2 py-1 text-center text-xs font-medium text-emerald-600">
            Semua izin dipilih.
          </p>
        ) : null}
      </div>
    </div>
  );
}
