/**
 * RoleWizard — FR-064 multi-section modal for creating a role with a level,
 * data scope and initial permission set (replaces the simple CreateRoleDialog).
 *
 * Sections:
 *  1. Identity          — name + description
 *  2. Template / Copy   — template chips + copy-from-role (pre-fills, editable)
 *  3. Level & scope     — numeric level, label and data scope (auto-suggested)
 *  4. Permissions       — grouped expandable checklist with search
 *  5. Validation & preview — server-side warnings + local effective-access summary
 */

import { useMemo, useState, type ReactNode } from "react";

import type {
  AdminRoleDto,
  RoleDataScope,
  RoleMetaResponse,
  RoleTemplateDto,
  ValidateRoleResponse,
} from "@contracts/rbac-admin";
import type { PermissionKey } from "@contracts/permissions";

import { rbacAdminApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

import { SourceSection } from "./wizard/SourceSection";
import { LevelScopeSection } from "./wizard/LevelScopeSection";
import { PermissionChecklist } from "./wizard/PermissionChecklist";
import { ValidationSection } from "./wizard/ValidationSection";

export function RoleWizard({
  meta,
  roles,
  onClose,
  onCreated,
}: {
  meta: RoleMetaResponse | null;
  roles: AdminRoleDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const groups = useMemo(() => meta?.groups ?? [], [meta?.groups]);
  const templates = useMemo(() => meta?.templates ?? [], [meta?.templates]);
  const highPrivilege = useMemo(
    () => meta?.highPrivilegePermissions ?? [],
    [meta?.highPrivilegePermissions]
  );
  const dataScopes = useMemo(
    () => meta?.roleLevel.dataScopes ?? [],
    [meta?.roleLevel.dataScopes]
  );
  const scopeSuggestions = useMemo(
    () => meta?.roleLevel.scopeSuggestions ?? [],
    [meta?.roleLevel.scopeSuggestions]
  );
  const defaultLevel = meta?.roleLevel.defaultLevel ?? 10;
  const defaultScope = meta?.roleLevel.defaultScope ?? "SELF";

  const allKeys = useMemo(
    () => groups.flatMap((g) => g.permissions.map((p) => p.key)),
    [groups]
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState(String(defaultLevel));
  const [levelLabel, setLevelLabel] = useState("");
  const [dataScope, setDataScope] = useState<RoleDataScope>(defaultScope);
  const [scopeTouched, setScopeTouched] = useState(false);
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [activeTemplateKey, setActiveTemplateKey] = useState<string | null>(null);
  const [activeCopyRoleId, setActiveCopyRoleId] = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateRoleResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleKey(key: PermissionKey, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleGroup(keys: readonly PermissionKey[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function applyTemplate(template: RoleTemplateDto) {
    const templateKeys: PermissionKey[] =
      template.basePermissions.includes("*")
        ? allKeys
        : template.basePermissions.filter(
            (key): key is PermissionKey => allKeys.includes(key as PermissionKey)
          );
    setSelected(new Set(templateKeys));
    setLevel(String(template.baseLevel));
    setLevelLabel("");
    setDataScope(template.baseScope);
    setScopeTouched(true);
    setActiveTemplateKey(template.key);
    setActiveCopyRoleId(null);
    setValidation(null);
  }

  async function copyFromRole(roleId: string) {
    setCopyLoading(roleId);
    try {
      const res = await rbacAdminApi.copyRole(roleId);
      const draft = res.data.data;
      if (!draft) throw new Error("Empty copy payload.");
      setSelected(new Set(draft.permissions));
      setLevel(String(draft.level));
      setLevelLabel(draft.levelLabel);
      setDataScope(draft.dataScope);
      setScopeTouched(true);
      if (!name.trim()) setName(draft.name);
      if (!description.trim()) setDescription(draft.description);
      setActiveCopyRoleId(roleId);
      setActiveTemplateKey(null);
      setValidation(null);
      toast.info(`Izin disalin dari ${draft.source.key}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Gagal menyalin peran.");
    } finally {
      setCopyLoading(null);
    }
  }

  function handleLevelChange(value: string) {
    setLevel(value);
    if (!scopeTouched) {
      const num = Number(value);
      if (Number.isInteger(num) && num >= 1 && num <= 1000) {
        const band = scopeSuggestions.find(
          (s) => num >= s.minLevel && num <= s.maxLevel
        );
        if (band) setDataScope(band.scope);
      }
    }
  }

  const scopeSuggestion = useMemo(() => {
    if (scopeTouched) return null;
    const num = Number(level);
    if (!Number.isInteger(num) || num < 1 || num > 1000) return null;
    return (
      scopeSuggestions.find((s) => num >= s.minLevel && num <= s.maxLevel)
        ?.scope ?? null
    );
  }, [level, scopeTouched, scopeSuggestions]);

  const parsedLevel = (): number | undefined => {
    const num = Number(level);
    return Number.isInteger(num) && num >= 1 && num <= 1000 ? num : undefined;
  };

  async function handleValidate() {
    setValidating(true);
    setValidation(null);
    try {
      const res = await rbacAdminApi.validateRole({
        permissions: [...selected],
        level: parsedLevel(),
        levelLabel: levelLabel.trim(),
        dataScope,
      });
      setValidation(res.data.data ?? null);
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Validasi gagal. Coba lagi.");
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit() {
    if (!name.trim() || selected.size === 0) {
      setError("Nama dan minimal satu izin wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await rbacAdminApi.createRole({
        name: name.trim(),
        description: description.trim(),
        permissions: [...selected],
        level: parsedLevel(),
        levelLabel: levelLabel.trim(),
        dataScope,
        ...(activeTemplateKey ? { templateKey: activeTemplateKey } : {}),
        ...(activeCopyRoleId ? { copyFromRoleId: activeCopyRoleId } : {}),
      });
      toast.success("Peran dibuat.");
      onCreated();
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Gagal membuat peran. Mungkin sudah ada.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Peran Baru" onClose={onClose}>
      {!meta ? (
        <div className="flex justify-center py-12">
          <Spinner label="Memuat templat peran & daftar periksa…" />
        </div>
      ) : (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <WizardSection label="1 · Identitas">
            <div className="space-y-3">
              <Input
                label="Nama"
                placeholder="mis. Spesialis Payroll"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                label="Deskripsi"
                placeholder="Deskripsi opsional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </WizardSection>

          <WizardSection label="2 · Templat atau salin">
            <SourceSection
              templates={templates}
              roles={roles}
              activeTemplateKey={activeTemplateKey}
              activeCopyRoleId={activeCopyRoleId}
              copyLoading={copyLoading}
              onApplyTemplate={applyTemplate}
              onCopyFromRole={copyFromRole}
            />
          </WizardSection>

          <WizardSection label="3 · Level & lingkup">
            <LevelScopeSection
              level={level}
              levelLabel={levelLabel}
              dataScope={dataScope}
              dataScopes={dataScopes}
              scopeTouched={scopeTouched}
              scopeSuggestion={scopeSuggestion}
              onLevelChange={handleLevelChange}
              onLevelLabelChange={setLevelLabel}
              onScopeChange={(scope) => {
                setDataScope(scope);
                setScopeTouched(true);
              }}
            />
          </WizardSection>

          <WizardSection label="4 · Izin awal">
            <PermissionChecklist
              groups={groups}
              selected={selected}
              onToggle={toggleKey}
              onToggleGroup={toggleGroup}
              onSelectAll={() => setSelected(new Set(allKeys))}
              onClearAll={() => setSelected(new Set())}
            />
          </WizardSection>

          <WizardSection label="5 · Validasi & pratinjau">
            <ValidationSection
              selected={selected}
              highPrivilege={highPrivilege}
              validating={validating}
              validation={validation}
              onValidate={handleValidate}
            />
          </WizardSection>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              Buat peran
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function WizardSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </h4>
      {children}
    </section>
  );
}
