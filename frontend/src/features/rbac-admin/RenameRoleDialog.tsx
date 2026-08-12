/**
 * RenameRoleDialog — rename/describe a role with optimistic-lock version
 * (FR-011 §5.2 PUT /roles/:id).
 */

import { useState } from "react";

import type { AdminRoleDto } from "@contracts/rbac-admin";

import { rbacAdminApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export function RenameRoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role: AdminRoleDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await rbacAdminApi.updateRole(role.id, {
        name: name.trim(),
        description: description.trim(),
        expectedVersion: role.version,
      });
      toast.success("Peran diperbarui.");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Penyimpanan gagal. Admin lain mungkin telah mengubah peran ini — muat ulang dan coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Ganti nama ${role.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Input
          label="Nama"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Deskripsi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            Simpan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
