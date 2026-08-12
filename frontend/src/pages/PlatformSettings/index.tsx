/**
 * PlatformSettingsPage — tabs: "Identitas Aplikasi" (branding) + "Kebijakan
 * Kata Sandi" (FR-044). Guarded by `platform:settings` (SUPER_ADMIN only in
 * the seed). Changes are validated, persisted, and audited (SETTINGS.CHANGED).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { passwordPolicyApi, type PasswordPolicyDto } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { BrandingSettingsPanel } from "@/features/branding/BrandingSettingsPanel";
// import { RoutingRulesPanel } from "@/features/admin/RoutingRulesPanel";

type SettingsTab = "identity" | "password";

export default function PlatformSettings() {
  const [tab, setTab] = useState<SettingsTab>("identity");
  const { data: policy, isLoading, isError, refetch } = useQuery({
    queryKey: ["password-policy"],
    queryFn: () => passwordPolicyApi.get().then((r) => r.data.data),
  });

  const [draft, setDraft] = useState<PasswordPolicyDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize the editable draft from the fetched policy once.
  const active = draft ?? policy;

  function update(key: keyof PasswordPolicyDto, value: number | boolean) {
    setDraft((prev) => ({ ...(prev ?? policy!), [key]: value }));
    setError(null);
  }

  async function handleSave() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      await passwordPolicyApi.update(active);
      toast.success("Kebijakan kata sandi diperbarui dan diaudit.");
      setDraft(null);
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Tidak dapat menyimpan kebijakan. Periksa nilainya dan coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat pengaturan platform..." />
      </div>
    );
  }

  if (isError || !active) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat pengaturan platform.
      </div>
    );
  }

  const hasChanges = Boolean(draft);

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: "identity", label: "Identitas Aplikasi" },
    { key: "password", label: "Kebijakan Kata Sandi" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">Pengaturan Platform</h2>
        <p className="text-sm text-slate-500">
          Kelola identitas aplikasi, branding, dan kebijakan keamanan platform.
        </p>
      </div>

      {/* Mini tab navigation */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-1">
        {tabs.map(({ key, label }) => (
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

      {tab === "identity" ? <BrandingSettingsPanel /> : null}

      {tab === "password" ? (
      <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
        <h3 className="mb-4 font-semibold">Kebijakan kata sandi</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Panjang minimum"
            type="number"
            min={8}
            max={64}
            value={active.minLength}
            onChange={(e) => update("minLength", Number(e.target.value))}
          />
          <Input
            label="Panjang maksimum"
            type="number"
            min={8}
            max={256}
            value={active.maxLength}
            onChange={(e) => update("maxLength", Number(e.target.value))}
          />
          <Input
            label="Kedaluwarsa (hari, 0 = tidak pernah)"
            type="number"
            min={0}
            max={3650}
            value={active.expiryDays}
            onChange={(e) => update("expiryDays", Number(e.target.value))}
          />
          <Input
            label="Panjang riwayat (mencegah penggunaan ulang)"
            type="number"
            min={0}
            max={20}
            value={active.historyLength}
            onChange={(e) => update("historyLength", Number(e.target.value))}
          />
        </div>

        <div className="mt-4 space-y-2">
          {(
            [
              ["requireUppercase", "Wajib mengandung huruf kapital"],
              ["requireLowercase", "Wajib mengandung huruf kecil"],
              ["requireDigit", "Wajib mengandung angka"],
              ["requireSpecial", "Wajib mengandung karakter khusus"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={active[key]}
                onChange={(e) => update(key, e.target.checked)}
                className="size-4 accent-slate-900"
              />
              {label}
            </label>
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

        <div className="mt-6 flex justify-end gap-2">
          {hasChanges ? (
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Buang
            </Button>
          ) : null}
          <Button onClick={handleSave} loading={saving} disabled={!hasChanges}>
            Simpan kebijakan
          </Button>
        </div>
      </div>
      ) : null}

      {/* <RoutingRulesPanel /> */}
    </div>
  );
}
