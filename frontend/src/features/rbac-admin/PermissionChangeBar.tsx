/**
 * PermissionChangeBar — staged permission changes with reason + Save/Undo
 * (FR-011 §6 MatrixChangeBar).
 */

import { useState } from "react";

import { Button } from "@/components/ui/Button";

export function PermissionChangeBar({
  changes,
  onApply,
}: {
  changes: Array<{ roleId: string; key: string; added: boolean }>;
  onApply: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const added = changes.filter((c) => c.added);
  const removed = changes.filter((c) => !c.added);

  async function handleSave() {
    setSaving(true);
    try {
      await onApply(reason);
      setReason("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-semibold text-amber-900">Perubahan izin yang belum disimpan</h4>
        <span className="text-xs text-amber-700">
          {added.length} ditambahkan · {removed.length} dihapus
        </span>
      </div>

      {added.length > 0 ? (
        <p className="mb-1 text-xs text-amber-800">
          <span className="font-medium">Tambah:</span> {added.map((c) => c.key).join(", ")}
        </p>
      ) : null}
      {removed.length > 0 ? (
        <p className="mb-3 text-xs text-amber-800">
          <span className="font-medium">Hapus:</span> {removed.map((c) => c.key).join(", ")}
        </p>
      ) : null}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Alasan perubahan (dicatat di log audit)"
          className="mb-3 h-10 w-full rounded-lg border border-amber-300 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
      />

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} loading={saving}>
          Simpan perubahan
        </Button>
      </div>
    </div>
  );
}
