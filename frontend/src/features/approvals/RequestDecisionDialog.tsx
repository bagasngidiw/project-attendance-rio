/**
 * RequestDecisionDialog — Approve/Reject flow for a PENDING request
 * (FR-007 / FR-008). Approve/Reject go through the shared approval-engine
 * surface (requestApi.approve / requestApi.reject); the rejection reason is
 * MANDATORY and the confirm button stays disabled until it is provided.
 * The server remains authoritative for assignment/eligibility.
 */

import { useState } from "react";
import axios from "axios";

import type { DecisionAction } from "@contracts/approvals";
import type { RequestDto } from "@contracts/requests";

import { requestApi } from "@/lib/axios";
import { requestTypeLabel } from "@/lib/labels";
import { claimFirstTooltip, needsClaimFirst } from "./claimable";
import { toast } from "@/lib/toast";
import { apiErrorMessage } from "@/lib/apiError";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function RequestDecisionDialog({
  request,
  action,
  onClose,
  onDecided,
}: {
  request: RequestDto;
  action: DecisionAction;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirmDisabled =
    action === "REJECTED" && reason.trim().length === 0;

  // Defensive: a ROLE-targeted request must be claimed before deciding.
  const mustClaim = needsClaimFirst(request);

  async function handleDecide() {
    setError(null);
    setSubmitting(true);
    try {
      if (action === "APPROVED") {
        await requestApi.approve(request.id);
      } else {
        await requestApi.reject(request.id, reason.trim());
      }
      toast.success(
        action === "APPROVED" ? "Permintaan disetujui." : "Permintaan ditolak."
      );
      onDecided();
    } catch (err) {
      const message = apiErrorMessage(err);
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError(
          message || "Permintaan ini tidak dapat diputuskan. Mungkin sudah diputuskan."
        );
      } else {
        setError(
          message || "Tidak dapat mencatat keputusan. Mungkin sudah diputuskan."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={action === "APPROVED" ? "Setujui permintaan" : "Tolak permintaan"}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="font-mono text-xs text-slate-400">{requestTypeLabel(request.type)}</p>

        {mustClaim ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            {claimFirstTooltip(request)} Gunakan tombol "Klaim" terlebih dahulu.
          </div>
        ) : null}

        {action === "REJECTED" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="rejection-reason"
              className="block text-sm font-medium text-slate-700"
            >
              Alasan <span className="text-red-600">*</span>
            </label>
            <textarea
              id="rejection-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="Alasan penolakan (wajib diisi)"
              className="h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>
        ) : null}

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
          <Button
            variant={action === "REJECTED" ? "danger" : "primary"}
            loading={submitting}
            disabled={confirmDisabled}
            onClick={handleDecide}
          >
            {action === "APPROVED" ? "Setujui" : "Tolak"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
