/**
 * ChangePasswordForm — self-service password change (FR-028 / FR-044).
 * Reused by the first-sign-in gate page and the Profile page. Shows live
 * policy hints, surfaces server violations, and refreshes the session so the
 * `mustChangePassword` gate clears.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";

import type { ApiEnvelope } from "@contracts/auth";

import { authApi, passwordPolicyApi } from "@/lib/axios";
import { validatePasswordAgainstPolicy } from "./passwordPolicy";
import { useAuth } from "./useAuth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function ChangePasswordForm({
  onSuccess,
  requireCurrent = true,
}: {
  onSuccess?: () => void;
  requireCurrent?: boolean;
}) {
  const { refreshSession } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverViolations, setServerViolations] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: policy } = useQuery({
    queryKey: ["password-policy"],
    queryFn: () => passwordPolicyApi.get().then((r) => r.data.data),
    retry: 1,
  });

  const hints = policy
    ? validatePasswordAgainstPolicy(policy, newPassword)
    : [];

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function handleSubmit(e: FormEvent) {
    console.log("🔥 handleSubmit called");

    e.preventDefault();
    if (mismatch) return;
    setServerError(null);
    setServerViolations([]);
    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // The change bumped tokenVersion; refresh re-issues a session with the
      // gate cleared (the axios 401-refresh path handles the stale token).
      await refreshSession();
      onSuccess?.();
    } catch (err) {
      const body = (err as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
      if (body?.code === "CURRENT_PASSWORD_INVALID") {
        setServerError("Kata sandi saat ini salah.");
      } else if (body?.code === "PASSWORD_POLICY") {
        setServerError("Kata sandi baru tidak memenuhi kebijakan platform.");
        setServerViolations(body.violations ?? []);
      } else {
        setServerError("Tidak dapat mengubah kata sandi Anda. Coba lagi.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {requireCurrent ? (
        <Input
          type="password"
          label="Kata sandi saat ini"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      ) : null}

      <Input
        type="password"
        label="Kata sandi baru"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
      />

      <Input
        type="password"
        label="Konfirmasi kata sandi baru"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
      />

      {mismatch ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Kata sandi tidak cocok.
        </p>
      ) : null}

      {hints.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {hints.map((hint) => (
            <li key={hint}>• {hint}</li>
          ))}
        </ul>
      ) : null}

      {serverError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {serverError}
        </div>
      ) : null}

      {serverViolations.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {serverViolations.map((violation) => (
            <li key={violation}>• {violation}</li>
          ))}
        </ul>
      ) : null}

      <Button type="submit" loading={submitting} className="w-full">
        Perbarui kata sandi
      </Button>
    </form>
  );
}
