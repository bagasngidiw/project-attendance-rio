/**
 * Sign-in page (design §6.1 / §6.3 SignInForm). Uses react-hook-form + Zod for
 * client-side validation mirroring the server schema.
 *
 * Error surfacing (FR-001, §5.5 non-revealing failures):
 *  - INVALID_CREDENTIALS  -> generic message; never reveals which field failed.
 *  - ACCOUNT_LOCKED (423) -> lockout message + live retry countdown; the submit
 *    button is disabled until the configured lockout period expires.
 *  - ACCOUNT_INACTIVE (403) -> inactive-account message pointing at the
 *    administrator.
 *  - Anything else -> generic message; server internals never reach the UI.
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AxiosError } from "axios";
import { Building2 } from "lucide-react";

import type { ApiEnvelope } from "@contracts/auth";

import { useAuth } from "@/features/auth/useAuth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/constants/routes";
import { useBranding } from "@/lib/branding";

const signInSchema = z.object({
  username: z
    .string()
    .min(2, "Nama pengguna harus minimal 2 karakter.")
    .max(64, "Nama pengguna terlalu panjang."),
  password: z
    .string()
    .min(8, "Kata sandi harus minimal 8 karakter.")
    .max(128, "Kata sandi terlalu panjang."),
});

type SignInFormValues = z.infer<typeof signInSchema>;

/** Categorized, wire-safe sign-in failure states (never raw server errors). */
type SignInFailure =
  | { kind: "locked"; retryAfterMs: number }
  | { kind: "inactive" }
  | { kind: "generic" };

/** Maps a sign-in rejection to a categorized UI state. */
function classifySignInError(error: unknown): SignInFailure {
  const body = (error as AxiosError<ApiEnvelope<never>>)?.response?.data?.error;
  if (body?.code === "AUTH_ACCOUNT_LOCKED") {
    return {
      kind: "locked",
      retryAfterMs:
        typeof body.retryAfterMs === "number" && body.retryAfterMs > 0
          ? body.retryAfterMs
          : 0,
    };
  }
  if (body?.code === "AUTH_ACCOUNT_INACTIVE") {
    return { kind: "inactive" };
  }
  return { kind: "generic" };
}

/** Formats a remaining-duration in whole seconds as `M:SS`. */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { applicationName, logoUrl } = useBranding();

  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Lockout duration in ms returned by the server; `null` when the account is
   * not locked. The lock deadline is derived inside the effect (impure clock
   * reads are confined to effects, keeping render pure).
   */
  const [lockedForMs, setLockedForMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const isLocked = lockedForMs !== null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { username: "", password: "" },
  });

  // Live retry countdown while the account is locked (design §6.1). The
  // effect is keyed on `lockedForMs` so a fresh lockout (re)starts the timer;
  // the deadline is captured once per lockout via the impure clock.
  useEffect(() => {
    if (lockedForMs === null) return;

    const lockEndsAt = Date.now() + lockedForMs;

    const tick = () => {
      const remaining = Math.max(0, lockEndsAt - Date.now());
      setRemainingSeconds(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        setLockedForMs(null);
        setRemainingSeconds(0);
        setFailure(null);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockedForMs]);

  const onSubmit = handleSubmit(async (values: SignInFormValues) => {
    if (isLocked) return;
    setFailure(null);
    setSubmitting(true);
    try {
      await signIn(values.username, values.password);
      const from = (location.state as { from?: { pathname?: string } } | null)
        ?.from?.pathname;
      navigate(from && from !== ROUTES.LOGIN ? from : ROUTES.DASHBOARD, {
        replace: true,
      });
    } catch (error) {
      const classified = classifySignInError(error);
      if (classified.kind === "locked" && classified.retryAfterMs > 0) {
        setLockedForMs(classified.retryAfterMs);
        setRemainingSeconds(Math.ceil(classified.retryAfterMs / 1000));
      }
      setFailure(classified);
    } finally {
      setSubmitting(false);
    }
  });

  const alertMessage = (() => {
    switch (failure?.kind) {
      case "locked":
        return isLocked
          ? `Akun ini untuk sementara dikunci setelah terlalu banyak percobaan masuk yang gagal. Coba lagi dalam ${formatCountdown(remainingSeconds)}.`
          : "Akun ini untuk sementara dikunci. Coba lagi nanti.";
      case "inactive":
        return "Akun ini tidak aktif. Hubungi administrator Anda.";
      default:
        return "Tidak dapat masuk. Periksa kredensial Anda atau hubungi administrator.";
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-[var(--brand-surface)] p-8 shadow-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-[var(--brand-on-primary)]">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={applicationName}
                  className="max-h-9 w-9 object-contain"
                />
              ) : (
                <Building2 size={28} />
              )}
            </div>
            <h1 className="text-2xl font-bold">{applicationName || "Platform HRIS"}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Masuk untuk mengakses ruang kerja Anda
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Nama pengguna"
              placeholder="mis. j.doe"
              autoComplete="username"
              autoFocus
              disabled={isLocked}
              error={errors.username?.message}
              {...register("username")}
            />

            <Input
              type="password"
              label="Kata sandi"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isLocked}
              error={errors.password?.message}
              {...register("password")}
            />

            {failure ? (
              <div
                role="alert"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  failure.kind === "generic"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {alertMessage}
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={submitting}
              disabled={isLocked}
            >
              {isLocked
                ? `Terkunci · coba lagi dalam ${formatCountdown(remainingSeconds)}`
                : submitting
                  ? "Masuk..."
                  : "Masuk"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Khusus personel yang berwenang. Semua akses dicatat.
        </p>
      </div>
    </div>
  );
}
