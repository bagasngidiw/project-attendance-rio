/**
 * DeactivateConfirmDialog — reversible deactivation with a clear warning
 * (FR-029). Deactivation preserves records and blocks sign-in.
 */

import { useState } from "react";

import { usersApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function DeactivateConfirmDialog({
  user,
  onClose,
  onSaved,
}: {
  user: { id: string; name: string; username: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleDeactivate() {
    setSubmitting(true);
    try {
      await usersApi.deactivate(user.id);
      toast.info(`${user.name} dinonaktifkan. Catatan mereka tetap dipertahankan.`);
      onSaved();
    } catch (err) {
      toast.error(
        apiErrorMessage(err) ??
          "Tidak dapat menonaktifkan pengguna ini. Mungkin mereka adalah Super Admin aktif terakhir."
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nonaktifkan pengguna" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          <span className="font-medium">{user.name}</span> (
          <span className="font-mono">{user.username}</span>) tidak akan dapat
          masuk lagi. Catatan historis mereka tetap utuh dan dapat diaktifkan
          kembali nanti.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="danger"
            loading={submitting}
            onClick={handleDeactivate}
          >
            Nonaktifkan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
