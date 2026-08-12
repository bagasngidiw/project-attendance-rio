/**
 * CorrectionDialog — HR corrects a record field with a required reason
 * (FR-020 §6.3). Shows the current value and a preview of old → new.
 */

import { useState } from "react";

import type { AttendanceRecordDto } from "@contracts/attendance";

import { attendanceApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function CorrectionDialog({
  record,
  onClose,
  onSaved,
}: {
  record: AttendanceRecordDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [field, setField] = useState<"clockInAt" | "clockOutAt">("clockInAt");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const current = record[field] ? new Date(record[field]).toLocaleString() : "—";
  const oldValue = record[field];

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("Alasan koreksi wajib diisi.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await attendanceApi.correct(record.id, {
        field,
        oldValue: oldValue ? new Date(oldValue).toISOString() : null,
        newValue: newValue ? new Date(newValue).toISOString() : null,
        reason: reason.trim(),
      });
      toast.success("Catatan absensi dikoreksi.");
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Tidak dapat mengoreksi catatan. Data mungkin telah berubah — muat ulang dan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Koreksi catatan absensi" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Bidang
          </label>
          <select
            value={field}
            onChange={(e) => {
              setField(e.target.value as "clockInAt" | "clockOutAt");
              setNewValue("");
              setError(null);
            }}
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
          >
            <option value="clockInAt">Waktu absen masuk</option>
            <option value="clockOutAt">Waktu absen keluar</option>
          </select>
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Nilai saat ini</span>
            <span className="font-medium">{current}</span>
          </div>
        </div>

        <Input
          type="datetime-local"
          label="Nilai baru"
          value={newValue}
          onChange={(e) => {
            setNewValue(e.target.value);
            setError(null);
          }}
        />

        <Input
          label="Alasan (wajib)"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          required
        />

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button loading={submitting} onClick={handleSubmit}>
            Terapkan koreksi
          </Button>
        </div>
      </div>
    </Modal>
  );
}
