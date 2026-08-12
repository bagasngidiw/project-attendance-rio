/**
 * OrgPicker — active departments/positions selects for user assignments
 * (FR-024 §6.4). Deactivated entries are excluded (they remain visible in the
 * management panels only).
 */

import { useQuery } from "@tanstack/react-query";

import type { DepartmentDto, PositionDto } from "@contracts/org";

import { orgApi } from "@/lib/axios";

export function DepartmentSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["org-departments-active"],
    queryFn: () =>
      orgApi.activeDepartments().then((r) => (r.data.data?.items as DepartmentDto[]) ?? []),
  });

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Departemen</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
      >
        <option value="">—</option>
        {(data ?? []).map((dept) => (
          <option key={dept.id} value={dept.id}>
            {dept.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PositionSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["org-positions-active"],
    queryFn: () =>
      orgApi.activePositions().then((r) => (r.data.data?.items as PositionDto[]) ?? []),
  });

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Jabatan</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
      >
        <option value="">—</option>
        {(data ?? []).map((position) => (
          <option key={position.id} value={position.id}>
            {position.name}
          </option>
        ))}
      </select>
    </div>
  );
}
