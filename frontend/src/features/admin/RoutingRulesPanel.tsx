/**
 * RoutingRulesPanel — FR-042 approval routing configuration (Super Admin).
 * Per request type: enabled toggle, fallback target, and level count. Changes
 * are validated, persisted, and audited (SETTINGS.CHANGED).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RoutingRuleDto } from "@contracts/approvals";

import { routingAdminApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { requestTypeLabel } from "@/lib/labels";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function RoutingRulesPanel() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["routing-rules"],
    queryFn: () => routingAdminApi.get().then((r) => r.data.data),
  });

  const [draft, setDraft] = useState<RoutingRuleDto[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules = draft ?? data ?? [];

  function update(index: number, patch: Partial<RoutingRuleDto>) {
    setDraft((prev) => {
      const base = prev ?? data ?? [];
      return base.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    });
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await routingAdminApi.update(rules);
      toast.success("Aturan perutean diperbarui dan diaudit.");
      setDraft(null);
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Tidak dapat menyimpan aturan perutean. Periksa nilainya dan coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Memuat aturan perutean..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat aturan perutean.
      </div>
    );
  }

  const hasChanges = Boolean(draft);

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
      <h3 className="mb-1 font-semibold">Perutean persetujuan</h3>
      <p className="mb-4 text-sm text-slate-500">
        Siapa yang menerima setiap jenis permintaan. Perubahan diaudit.
      </p>

      <div className="space-y-4">
        {rules.map((rule, index) => (
          <div
            key={requestTypeLabel(rule.requestType)}
            className="rounded-lg border border-slate-100 bg-slate-50 p-4"
          >
            <div className="flex flex-wrap items-center gap-4">
              <span className="w-24 font-medium">{requestTypeLabel(rule.requestType)}</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                  className="size-4 accent-slate-900"
                />
                Aktif
              </label>
              <label className="flex items-center gap-2 text-sm">
                Level
                <select
                  value={rule.levels.length}
                  disabled
                  className="h-9 rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-2 text-sm"
                >
                  <option value={1}>1</option>
                </select>
                <span className="text-xs text-slate-400">(manajer pemohon)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                Cadangan
                <select
                  value={rule.fallback}
                  onChange={(e) =>
                    update(index, {
                      fallback: e.target.value as RoutingRuleDto["fallback"],
                    })
                  }
                  className="h-9 rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-2 text-sm"
                >
                  <option value="ACTIVE_HR_ADMIN">HR Admin Aktif</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        {hasChanges ? (
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Buang
          </Button>
        ) : null}
        <Button onClick={handleSave} loading={saving} disabled={!hasChanges}>
          Simpan aturan perutean
        </Button>
      </div>
    </div>
  );
}
