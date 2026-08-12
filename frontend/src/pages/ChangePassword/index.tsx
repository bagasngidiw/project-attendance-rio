/**
 * ChangePasswordPage — the first-sign-in gate (FR-028 §5.2): a user who must
 * set their own password sees this full-screen form before the app renders.
 * After a successful change the session refreshes and the app shell appears.
 */

import { Navigate } from "react-router-dom";

import { useAuth } from "@/features/auth/useAuth";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { ROUTES } from "@/constants/routes";
import { Lock } from "lucide-react";

export default function ChangePasswordPage() {
  const { user } = useAuth();

  if (!user?.mustChangePassword && !user?.passwordExpired) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-[var(--brand-surface)] p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-black text-white">
            <Lock size={28} />
          </div>
          <h1 className="text-2xl font-bold">Tetapkan kata sandi baru</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user?.passwordExpired
              ? "Kata sandi Anda telah kedaluwarsa. Pilih yang baru untuk melanjutkan."
              : "Akun Anda dibuat dengan kredensial sementara. Pilih kata sandi pribadi untuk melanjutkan."}
          </p>
        </div>

        <ChangePasswordForm
          onSuccess={() => {
            // Session refreshed with the gate cleared; the RequirePasswordChange
            // guard lets the app shell render from here.
            window.location.href = ROUTES.DASHBOARD;
          }}
        />

        <p className="mt-6 text-center text-xs text-slate-400">
          Khusus personel yang berwenang. Semua akses dicatat.
        </p>
      </div>
    </div>
  );
}
