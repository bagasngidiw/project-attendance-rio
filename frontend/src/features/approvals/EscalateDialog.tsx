/**
 * EscalateDialog — requester/approver escalation of a PENDING request
 * (FR-063): optional message + confirm. Surfaces the 409 rate-limit as a
 * friendly inline error.
 */

import { useState } from "react";
import axios from "axios";

import type { RequestDto } from "@contracts/requests";

import { approvalApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function EscalateDialog({
  request,
  onClose,
  onEscalated,
}: {
  request: RequestDto;
  onClose: () => void;
  onEscalated: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleEscalate() {
    setError(null);
    setSubmitting(true);
    try {
      await approvalApi.escalate(request.id, { message: message.trim() });
      toast.success("Permintaan dieskalasi.");
      onEscalated();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError(
          apiErrorMessage(err) ??
            "Eskalasi dibatasi kecepatannya. Silakan coba lagi beberapa saat kemudian."
        );
      } else {
        setError(
          apiErrorMessage(err) ?? "Tidak dapat mengeskalasi permintaan ini saat ini."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Eskalasi permintaan" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Eskalasi permintaan MENUNGGU ini agar tingkat yang lebih tinggi
          diberitahu. Status permintaan tidak berubah.
        </p>

        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setError(null);
          }}
          placeholder="Pesan opsional untuk eskalasi"
          className="h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
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
          <Button loading={submitting} onClick={handleEscalate}>
            Eskalasi
          </Button>
        </div>
      </div>
    </Modal>
  );
}
