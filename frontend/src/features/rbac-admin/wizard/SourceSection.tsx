/**
 * SourceSection — role wizard step 2: choose a starting point from a role
 * template chip or by copying an existing role (FR-064 V.6). Selections
 * pre-fill permissions/level/scope but remain fully editable before save.
 */

import type { AdminRoleDto, RoleTemplateDto } from "@contracts/rbac-admin";

export function SourceSection({
  templates,
  roles,
  activeTemplateKey,
  activeCopyRoleId,
  copyLoading,
  onApplyTemplate,
  onCopyFromRole,
}: {
  templates: RoleTemplateDto[];
  roles: AdminRoleDto[];
  activeTemplateKey: string | null;
  activeCopyRoleId: string | null;
  copyLoading: string | null;
  onApplyTemplate: (template: RoleTemplateDto) => void;
  onCopyFromRole: (roleId: string) => void;
}) {
  const activeTemplate = templates.find((t) => t.key === activeTemplateKey);
  const copiedRole = roles.find((r) => r.id === activeCopyRoleId);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 block text-sm font-medium text-slate-700">
          Mulai dari templat
        </p>
        <div className="flex flex-wrap gap-1.5">
          {templates.map((template) => {
            const active = template.key === activeTemplateKey;
            return (
              <button
                key={template.key}
                type="button"
                title={template.description}
                onClick={() => onApplyTemplate(template)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-[var(--brand-surface)] text-slate-700 hover:bg-slate-50"
                }`}
              >
                {template.name}
              </button>
            );
          })}
        </div>
        {activeTemplate ? (
          <p className="mt-1.5 text-xs text-slate-500">{activeTemplate.description}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="copy-from-role" className="mb-1.5 block text-sm font-medium text-slate-700">
          Salin dari peran
        </label>
        <select
          id="copy-from-role"
          value={activeCopyRoleId ?? ""}
          onChange={(e) => {
            const roleId = e.target.value;
            if (roleId) onCopyFromRole(roleId);
          }}
          className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
        >
          <option value="">Tidak ada — buat dari awal</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name} ({role.key})
            </option>
          ))}
        </select>
        {copyLoading ? (
          <p className="mt-1.5 text-xs text-slate-500">Memuat salinan peran…</p>
        ) : copiedRole ? (
          <p className="mt-1.5 text-xs text-slate-500">
            Disalin dari {copiedRole.key}. Izin, level, dan lingkup dapat
            diubah sebelum disimpan.
          </p>
        ) : null}
      </div>
    </div>
  );
}
