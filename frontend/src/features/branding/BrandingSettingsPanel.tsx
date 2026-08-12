/**
 * BrandingSettingsPanel (FR-006 + UIUXDESIGN.md product decision) — inside
 * "Pengaturan Platform". The customer configures ONLY the application IDENTITY
 * (name, short name, logo). Colors are product-controlled (fixed SIMBIKA
 * palette) and are NOT editable here.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { BrandingDto, BrandingLogo } from "@contracts/platform";

import { brandingApi } from "@/lib/axios";
import { applyBranding } from "@/lib/branding";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

import { ThemePreview } from "./ThemePreview";

interface BrandingDraft {
  applicationName: string;
  applicationShortName: string;
  logo: BrandingLogo | null;
}

function toDraft(saved: BrandingDto): BrandingDraft {
  return {
    applicationName: saved.applicationName,
    applicationShortName: saved.applicationShortName,
    logo: saved.logo,
  };
}

export function BrandingSettingsPanel() {
  const { data: saved, isLoading, isError, refetch } = useQuery({
    queryKey: ["branding"],
    queryFn: () => brandingApi.get().then((r) => r.data.data),
  });

  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const active = useMemo<BrandingDraft | null>(() => {
    if (draft) return draft;
    if (!saved) return null;
    return toDraft(saved);
  }, [draft, saved]);

  const dirty = useMemo(() => {
    if (!saved || !active) return false;
    return JSON.stringify(active) !== JSON.stringify(toDraft(saved));
  }, [saved, active]);

  // Warn before closing/refreshing with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update<K extends keyof BrandingDraft>(key: K, value: BrandingDraft[K]) {
    setDraft((prev) => ({ ...(prev ?? toDraft(saved as BrandingDto)), [key]: value }));
    setError(null);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { data } = await brandingApi.uploadLogo(file);
      if (data.data?.logo) update("logo", data.data.logo);
      toast.success("Logo siap disimpan. Klik 'Simpan Perubahan' untuk menerapkan.");
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Logo gagal diunggah. Periksa format dan ukuran file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveLogo() {
    setError(null);
    try {
      await brandingApi.removeLogo();
      update("logo", null);
      toast.info("Logo akan dihapus setelah disimpan.");
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Tidak dapat menghapus logo.");
    }
  }

  async function handleSave() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      await brandingApi.update({
        applicationName: active.applicationName,
        applicationShortName: active.applicationShortName,
        logo: active.logo ?? null,
      });
      toast.success("Identitas aplikasi diperbarui.");
      setDraft(null);
      await refetch();
      const latest = (await brandingApi.get()).data.data;
      if (latest) applyBranding(latest);
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Tidak dapat menyimpan pengaturan branding.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Memuat branding..." />
      </div>
    );
  }

  if (isError || !active) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat pengaturan branding.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-6">
      <h3 className="mb-1 font-semibold">Identitas Aplikasi</h3>
      <p className="mb-4 text-sm text-[var(--brand-text-muted)]">
        Nama dan logo aplikasi akan digunakan pada header, sidebar, halaman
        login, dan area branding lainnya.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nama Aplikasi"
          value={active.applicationName}
          maxLength={80}
          onChange={(e) => update("applicationName", e.target.value)}
        />
        <Input
          label="Nama Singkatan Aplikasi"
          value={active.applicationShortName}
          maxLength={16}
          onChange={(e) => update("applicationShortName", e.target.value)}
        />
      </div>

      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold">Logo Aplikasi</h4>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-[var(--brand-border)] bg-[var(--brand-background)]">
            {active.logo?.url ? (
              <img
                src={active.logo.url}
                alt="Logo aplikasi"
                className="max-h-16 max-w-full object-contain"
              />
            ) : (
              <span className="text-2xl font-bold text-[var(--brand-text-muted)]">
                {active.applicationShortName.charAt(0) || "H"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-medium text-[var(--brand-on-primary)]">
                {uploading ? "Mengunggah..." : active.logo ? "Ganti Logo" : "Unggah Logo"}
              </span>
            </label>
            {active.logo ? (
              <Button variant="secondary" onClick={handleRemoveLogo}>
                Hapus Logo
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--brand-text-muted)]">
          PNG, JPG, atau SVG. Ukuran maksimal 2 MB. Latar belakang transparan disarankan.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-end gap-2">
        {dirty ? (
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Buang
          </Button>
        ) : null}
        <Button onClick={handleSave} loading={saving} disabled={!dirty}>
          Simpan Perubahan
        </Button>
      </div>

      {/* Identity preview on the FIXED product palette (no color controls). */}
      <ThemePreview
        applicationName={active.applicationName}
        applicationShortName={active.applicationShortName}
        logoUrl={active.logo?.url ?? null}
      />
    </section>
  );
}
