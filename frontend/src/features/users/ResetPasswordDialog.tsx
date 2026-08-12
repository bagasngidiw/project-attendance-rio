/**
 * ResetPasswordDialog — admin password reset (FR-028): sets a temporary
 * credential and re-arms the must-change gate.
 */

import { useState, type FormEvent } from "react";

import { usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PasswordHints } from "@/features/auth/PasswordHints";

export function ResetPasswordDialog({
  userId,
  username,
  onClose,
  onSaved,
}: {
  userId: string;
  username: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await usersApi.resetPassword(userId, temporaryPassword);
      toast.success(
        `Kata sandi ${username} direset. Mereka harus mengubahnya pada masuk berikutnya.`
      );
      onSaved();
    } catch (err) {
      setError(
        apiErrorMessage(err) ??
          "Tidak dapat mereset kata sandi. Coba lagi."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Reset kata sandi — ${username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          Pengguna akan memerlukan kredensial sementara ini dan harus menetapkan
          kata sandi pribadi pada masuk berikutnya. Sesi yang ada akan dibatalkan.
        </p>
        <Input
          label="Kata sandi sementara"
          type="password"
          autoComplete="new-password"
          value={temporaryPassword}
          onChange={(e) => setTemporaryPassword(e.target.value)}
          required
        />
        <PasswordHints password={temporaryPassword} />

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={submitting} variant="danger">
            Reset kata sandi
          </Button>
        </div>
      </form>
    </Modal>
  );
}
