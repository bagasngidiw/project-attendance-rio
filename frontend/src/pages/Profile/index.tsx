/**
 * ProfilePage — FR-021 employee self-service: read-only identity + editable
 * self-service fields (gated by `profile:update`) + change-password section.
 * HR-managed fields are shown read-only with a hint.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";
import type { ProfileDto, ProfileUpdateDto } from "@contracts/profile";
import { PERMISSIONS } from "@contracts/permissions";

import { profileApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Can } from "@/features/auth/Can";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export default function Profile() {
  const queryClient = useQueryClient();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["profile"],
    queryFn: () => profileApi.get().then((r) => r.data.data),
  });

  // Edits are held as a partial diff over the fetched profile; `value` is the
  // merged display state. This avoids an effect that seeds form state.
  const [form, setForm] = useState<ProfileUpdateDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat profil..." />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat profil Anda.
      </div>
    );
  }

  // Narrowed reference (TS keeps narrowing across closures for this const).
  const current = profile;

  const value = form ?? snapshotFrom(current);

  function update(key: keyof ProfileUpdateDto, fieldValue: string) {
    setForm((prev) => ({ ...(prev ?? snapshotFrom(current)), [key]: fieldValue }));
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await profileApi.update(value);
      toast.success("Profil diperbarui.");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      if (res.data.data) setForm(null);
    } catch (err) {
      const body = (err as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
      setError(
        apiErrorMessage(err) ??
          (body?.code === "FIELD_NOT_EDITABLE"
            ? "Beberapa bidang dikelola oleh HR dan tidak dapat diubah di sini."
            : body?.code === "USER_EXISTS"
              ? "Email tersebut sudah digunakan."
              : "Tidak dapat menyimpan profil Anda.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">Profil</h2>
        <p className="text-sm text-slate-500">
          Identitas dan pengaturan akun Anda.
        </p>
      </div>

      <IdentityCard profile={profile} />

      <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
        <h3 className="mb-1 font-semibold">Detail kontak</h3>
        <p className="mb-4 text-sm text-slate-500">
          Perbarui informasi kontak Anda. Bidang kepegawaian dikelola oleh HR.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Email kerja"
            type="email"
            value={value.email ?? ""}
            onChange={(e) => update("email", e.target.value)}
          />
          <Input
            label="Telepon"
            value={value.phone ?? ""}
            onChange={(e) => update("phone", e.target.value)}
          />
          <Input
            label="Alamat"
            value={value.address ?? ""}
            onChange={(e) => update("address", e.target.value)}
          />
          <Input
            label="Kontak darurat"
            value={value.emergencyContact ?? ""}
            onChange={(e) => update("emergencyContact", e.target.value)}
          />
          <Input
            label="Email pribadi"
            type="email"
            value={value.personalEmail ?? ""}
            onChange={(e) => update("personalEmail", e.target.value)}
          />
          <Input
            label="Rekening bank"
            placeholder={profile.bankAccount ?? "Belum diatur"}
            value={value.bankAccount ?? ""}
            onChange={(e) => update("bankAccount", e.target.value)}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <Can permission={PERMISSIONS.PROFILE_UPDATE}>
            <Button onClick={handleSave} loading={saving}>
              Simpan perubahan
            </Button>
          </Can>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
        <h3 className="mb-1 font-semibold">Ganti kata sandi</h3>
        <p className="mb-4 text-sm text-slate-500">
          Pilih kata sandi baru. Kata sandi terbaru tidak dapat digunakan kembali.
        </p>
        <ChangePasswordForm onSuccess={() => {}} requireCurrent />
      </div>
    </div>
  );
}

function IdentityCard({ profile }: { profile: ProfileDto }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Nama <span className="ml-1 text-slate-300">(dikelola oleh HR)</span>
          </dt>
          <dd className="mt-1 font-medium">{profile.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Nama pengguna
          </dt>
          <dd className="mt-1 font-mono text-sm">{profile.username}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Status
          </dt>
          <dd className="mt-1">
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
              {profile.status}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Peran
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {profile.roles.map((role) => (
              <span
                key={role}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
              >
                {role}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function snapshotFrom(profile: ProfileDto): ProfileUpdateDto {
  return {
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    emergencyContact: profile.emergencyContact,
    personalEmail: profile.personalEmail,
  };
}
