/**
 * MasterSelects — ContractTypeSelect + PlacementSelect (NEW UPDATE TAD
 * SIMBIKA). Active master data from the database, used by the user
 * create/edit forms. Follows the OrgPicker select pattern.
 */

import { useQuery } from "@tanstack/react-query";

import type { ContractTypeDto } from "@contracts/contract-type";
import type { PlacementDto } from "@contracts/placement";

import { contractTypeApi, placementApi } from "@/lib/axios";

/**
 * Contract-type select. `value` is an ObjectId string (or "" for none).
 * If the currently held value is no longer in the active list (e.g. the
 * master record was deactivated), it is still rendered so the form never
 * silently drops existing data.
 */
export function ContractTypeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["contract-types-active"],
    queryFn: () => contractTypeApi.list().then((r) => (r.data.data as ContractTypeDto[]) ?? []),
  });

  const items = data ?? [];
  const held = value && !items.some((item) => item.id === value) ? value : null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Kontrak</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <option value="">—</option>
        {held ? <option value={held}>Kontrak (nonaktif)</option> : null}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Placement select. Same contract as ContractTypeSelect.
 */
export function PlacementSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["placements-active"],
    queryFn: () => placementApi.list().then((r) => (r.data.data as PlacementDto[]) ?? []),
  });

  const items = data ?? [];
  const held = value && !items.some((item) => item.id === value) ? value : null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Penempatan</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <option value="">—</option>
        {held ? <option value={held}>Penempatan (nonaktif)</option> : null}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
