/**
 * RequestDecisionCard — full request detail + immutable history timeline with
 * Approve / Reject decision actions (FR-007). Rejection requires a reason.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import type { RequestDto } from "@contracts/requests";

import { approvalApi } from "@/lib/axios";
import { payloadDisplayValue, payloadLabel, requestTypeLabel, isInternalPayloadKey } from "@/lib/labels";
import { useLeaveTypeNames, leaveSummaryName, useSicknessTypeNames, sicknessSummaryName } from "@/features/requests/useLeaveTypeNames";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { RequestTimeline } from "@/features/requests/RequestTimeline";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { claimFirstTooltip, needsClaimFirst } from "@/features/approvals/claimable";

/** Extracts the backend's error message when present (falls back to null). */
function apiErrorMessage(err: unknown): string | null {
  if (axios.isAxiosError<{ error?: { message?: string } }>(err)) {
    return err.response?.data?.error?.message ?? null;
  }
  return null;
}

export function RequestDecisionCard({
  request,
  onClose,
  onDecided,
}: {
  request: RequestDto;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const { data: history } = useQuery({
    queryKey: ["request-history", request.id],
    queryFn: () => approvalApi.requestHistory(request.id).then((r) => r.data.data),
  });

  async function handleDecide(decision: "APPROVED" | "REJECTED") {
    // FR-063 U.6: the rejection reason is optional and may be left blank.
    setError(null);
    setSubmitting(decision);
    try {
      await approvalApi.decide(request.id, { decision, comment: comment.trim() });
      toast.success(
        decision === "APPROVED" ? "Permintaan disetujui." : "Permintaan ditolak."
      );
      onDecided();
    } catch (err) {
      setError(
        apiErrorMessage(err) ||
          "Tidak dapat mencatat keputusan. Mungkin sudah diputuskan."
      );
    } finally {
      setSubmitting(null);
    }
  }

  const p = request.payload as Record<string, string>;

  const names = useLeaveTypeNames();
  const sicknessNames = useSicknessTypeNames();

  return (
    <Modal title="Tinjau permintaan" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-slate-400">{requestTypeLabel(request.type)}</p>
            <h4 className="font-semibold">{summary(request, names, sicknessNames)}</h4>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <dl className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          {Object.entries(p)
            .filter(([key]) => !isInternalPayloadKey(key))
            .map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4">
                <dt className="text-slate-500">{payloadLabel(key)}</dt>
                <dd className="text-right font-medium text-slate-700">
                  {payloadDisplayValue(p, key, value, names, sicknessNames)}
                </dd>
              </div>
            ))}
        </dl>

        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Riwayat
          </h5>
          {history ? (
            <RequestTimeline events={history.events} />
          ) : (
            <Spinner label="Memuat riwayat..." className="py-4" />
          )}
        </div>

        <textarea
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError(null);
          }}
          placeholder="Komentar (wajib saat menolak)"
          className="h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
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
            Tutup
          </Button>
          <Button
            variant="danger"
            loading={submitting === "REJECTED"}
            disabled={needsClaimFirst(request)}
            title={needsClaimFirst(request) ? claimFirstTooltip(request) : undefined}
            onClick={() => handleDecide("REJECTED")}
          >
            Tolak
          </Button>
          <Button
            loading={submitting === "APPROVED"}
            disabled={needsClaimFirst(request)}
            title={needsClaimFirst(request) ? claimFirstTooltip(request) : undefined}
            onClick={() => handleDecide("APPROVED")}
          >
            Setujui
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function summary(
  request: RequestDto,
  names: Record<string, string>,
  sicknessNames: Record<string, string>
): string {
  const p = request.payload as Record<string, string>;
  if (request.type === "LEAVE") return `${leaveSummaryName(p, names)}`;
  if (request.type === "OVERTIME") return `Lembur`;
  if (request.type === "PERMISSION") {
    return p.date ? `Ijin — ${p.date}` : `Ijin — ${p.startDate} s.d. ${p.endDate}`;
  }
  if (request.type === "SAKIT") {
    const name = sicknessSummaryName(p, sicknessNames);
    const range = p.endDate && p.endDate !== p.startDate
      ? `${p.startDate} s.d. ${p.endDate}`
      : p.startDate;
    return `${name ? `${name} ` : ""}Sakit — ${range}`;
  }
  return `Perjalanan dinas ke ${p.destination}`;
}
