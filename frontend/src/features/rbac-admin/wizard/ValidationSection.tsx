/**
 * ValidationSection — role wizard step 5: server-side validation warnings
 * (dependencies in yellow, high-privilege in red) plus a local effective-access
 * summary computed from the selected permissions (FR-064). Preview for an
 * existing role lives on the console; this is the pre-create equivalent.
 */

import { useMemo } from "react";

import type {
  DependencyWarningDto,
  ValidateRoleResponse,
} from "@contracts/rbac-admin";
import type { PermissionKey } from "@contracts/permissions";

import { Button } from "@/components/ui/Button";
import { buildLocalPreview, type LocalPreview } from "./localPreview";

export function ValidationSection({
  selected,
  highPrivilege,
  validating,
  validation,
  onValidate,
}: {
  selected: ReadonlySet<PermissionKey>;
  highPrivilege: readonly string[];
  validating: boolean;
  validation: ValidateRoleResponse | null;
  onValidate: () => void;
}) {
  const preview = useMemo(
    () => buildLocalPreview([...selected], highPrivilege),
    [selected, highPrivilege]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Validasi &amp; pratinjau</p>
        <Button variant="secondary" size="sm" onClick={onValidate} loading={validating}>
          Validasi
        </Button>
      </div>

      {validation ? (
        <div className="space-y-2">
          {validation.dependencies.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Peringatan dependensi
              </p>
              {validation.dependencies.map((dep) => (
                <DependencyWarning key={dep.permission} dep={dep} />
              ))}
            </div>
          ) : null}

          {validation.highPrivilege.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Peringatan hak istimewa tinggi
              </p>
              <p className="mt-1 text-xs text-red-700">
                {validation.highPrivilege.join(", ")}
              </p>
            </div>
          ) : null}

          {validation.dependencies.length === 0 &&
          validation.highPrivilege.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Tidak ada peringatan dependensi atau hak istimewa tinggi.
            </p>
          ) : null}
        </div>
      ) : null}

      <PreviewSummary preview={preview} />
    </div>
  );
}

function DependencyWarning({ dep }: { dep: DependencyWarningDto }) {
  return (
    <p className="text-xs text-amber-800">
      <span className="font-mono font-medium">{dep.permission}</span>
      <span className="mx-1">→</span>
      {dep.label}
      <span className="ml-1 text-amber-600">
        (hilang: {dep.requires.join(", ") || "—"})
      </span>
    </p>
  );
}

function PreviewSummary({ preview }: { preview: LocalPreview }) {
  return (
    <div className="rounded-lg border border-slate-200">
      <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Ringkasan akses efektif
      </p>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <PreviewBlock
          title="Modul menu"
          empty="Tidak ada"
          items={preview.menuModules.map(
            (m) => `${m.module} (${m.permissions.length})`
          )}
        />
        <PreviewBlock
          title="Wewenang persetujuan"
          empty="Tidak ada"
          items={preview.approvalAuthority}
        />
        <PreviewBlock
          title="Izin laporan"
          empty="Tidak ada"
          items={preview.reportPermissions}
        />
        <PreviewBlock
          title="Kemampuan admin"
          empty="Tidak ada"
          items={preview.adminCapabilities}
        />
      </div>
    </div>
  );
}

function PreviewBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-600">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {items.map((item) => (
            <li key={item} className="truncate font-mono text-xs text-slate-500">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-400">{empty}</p>
      )}
    </div>
  );
}
