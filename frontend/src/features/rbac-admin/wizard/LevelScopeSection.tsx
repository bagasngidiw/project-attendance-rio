/**
 * LevelScopeSection — role wizard step 3: role level (numeric), human label
 * and data scope. When the level changes and the scope has not been edited,
 * a suggested default scope is derived from the meta scope bands (FR-064).
 */

import type { RoleDataScope } from "@contracts/rbac-admin";

import { Input } from "@/components/ui/Input";

export function LevelScopeSection({
  level,
  levelLabel,
  dataScope,
  dataScopes,
  scopeTouched,
  scopeSuggestion,
  onLevelChange,
  onLevelLabelChange,
  onScopeChange,
}: {
  level: string;
  levelLabel: string;
  dataScope: RoleDataScope;
  dataScopes: readonly RoleDataScope[];
  scopeTouched: boolean;
  scopeSuggestion: RoleDataScope | null;
  onLevelChange: (value: string) => void;
  onLevelLabelChange: (value: string) => void;
  onScopeChange: (scope: RoleDataScope) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Level"
          type="number"
          min={1}
          max={1000}
          placeholder="mis. 50"
          value={level}
          onChange={(e) => onLevelChange(e.target.value)}
          hint="Level lebih tinggi = wewenang lebih besar."
        />
        <Input
          label="Label level"
          placeholder="mis. Team Lead"
          value={levelLabel}
          onChange={(e) => onLevelLabelChange(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="data-scope" className="mb-1.5 block text-sm font-medium text-slate-700">
          Lingkup data
        </label>
        <select
          id="data-scope"
          value={dataScope}
          onChange={(e) => onScopeChange(e.target.value as RoleDataScope)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
        >
          {dataScopes.map((scope) => (
            <option key={scope} value={scope}>
              {scope}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-slate-500">
          {scopeTouched
            ? "Lingkup diatur manual — tidak akan disesuaikan otomatis oleh level."
            : scopeSuggestion
              ? `Disarankan untuk Lv ${level || "—"}: ${scopeSuggestion}. Ubah level untuk memperbarui otomatis, atau pilih lingkup secara manual.`
              : "Lingkup disarankan otomatis dari level hingga Anda memilihnya secara manual."}
        </p>
      </div>
    </div>
  );
}
