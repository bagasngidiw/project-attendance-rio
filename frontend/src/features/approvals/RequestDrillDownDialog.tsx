/**
 * RequestDrillDownDialog — FR-063 drill-down: request payload, immutable
 * history timeline, decision summary, and Approve/Reject actions for PENDING
 * rows. FR-008 adds a "Klaim Persetujuan" action for role-targeted PENDING
 * requests that are not yet assigned to an approver.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import type { DecisionAction } from "@contracts/approvals";
import type { RequestDto, RequestType } from "@contracts/requests";
import { PERMISSIONS, type PermissionKey } from "@contracts/permissions";

import { approvalApi, requestApi } from "@/lib/axios";
import { toast } from "@/lib/toast";
import { apiErrorMessage } from "@/lib/apiError";
import { payloadDisplayValue, payloadLabel, requestStatusLabel, requestTypeLabel, isInternalPayloadKey } from "@/lib/labels";
import { useLeaveTypeNames, leaveSummaryName, useSicknessTypeNames, sicknessSummaryName } from "@/features/requests/useLeaveTypeNames";
import { usePermission } from "@/features/auth/usePermission";
import { claimFirstTooltip, needsClaimFirst } from "@/features/approvals/claimable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { RequestTimeline } from "@/features/requests/RequestTimeline";
import { RequestAttachments } from "@/features/requests/RequestAttachments";
import { StatusBadge } from "@/features/requests/StatusBadge";

import { RequestDecisionDialog } from "./RequestDecisionDialog";

const APPROVE_BY_TYPE: Record<RequestType, PermissionKey> = {
  LEAVE: PERMISSIONS.LEAVE_APPROVE,
  OVERTIME: PERMISSIONS.OVERTIME_APPROVE,
  TRIP: PERMISSIONS.TRIP_APPROVE,
  PERMISSION: PERMISSIONS.PERMISSION_APPROVE,
  SAKIT: PERMISSIONS.SAKIT_APPROVE,
};

export function RequestDrillDownDialog({
  requestId,
  onClose,
  onDecided,
}: {
  requestId: string;
  onClose: () => void;
  onDecided?: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["approval-drill-down", requestId],
    queryFn: () => approvalApi.drillDown(requestId).then((r) => r.data.data),
  });

  const { hasPermission } = usePermission();
  const [decisionAction, setDecisionAction] = useState<DecisionAction | null>(
    null
  );
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const request = data?.request;
  const canApprove = request
    ? hasPermission(APPROVE_BY_TYPE[request.type])
    : false;
  const canClaim = Boolean(
    request &&
      request.status === "PENDING_APPROVAL" &&
      request.approval?.targetType === "ROLE" &&
      request.approval.assignedUserId == null &&
      hasPermission(APPROVE_BY_TYPE[request.type])
  );

  async function handleClaim() {
    if (!request) return;
    setClaiming(true);
    setClaimError(null);
    try {
      await requestApi.claim(request.id);
      toast.success("Permintaan diklaim. Anda kini penyetuju yang ditugaskan.");
      await refetch();
    } catch (err) {
      const message = apiErrorMessage(err);
      if (axios.isAxiosError(err) && (err.response?.status === 409 || err.response?.status === 403)) {
        setClaimError(
          message || "Tidak dapat mengklaim permintaan ini. Mungkin sudah diklaim."
        );
      } else {
        setClaimError(message || "Tidak dapat mengklaim permintaan ini saat ini.");
      }
      refetch();
    } finally {
      setClaiming(false);
    }
  }

  const names = useLeaveTypeNames();
  const sicknessNames = useSicknessTypeNames();

  return (
    <>
      <Modal title="Tinjau permintaan" onClose={onClose}>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner label="Memuat permintaan..." />
          </div>
        ) : isError || !data || !request ? (
          <p className="text-sm text-red-600">Tidak dapat memuat permintaan.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-xs text-slate-400">{requestTypeLabel(request.type)}</p>
                <h4 className="font-semibold">{summaryLabel(request, names, sicknessNames)}</h4>
              </div>
              <StatusBadge status={request.status} />
            </div>

            <PayloadSummary
              request={request}
              names={names}
              sicknessNames={sicknessNames}
            />

            {/* FR-010: supporting documents, authorization-controlled by the backend. */}
            <RequestAttachments requestId={request.id} />

            {request.decision ? (
              <DecisionSummary request={request} />
            ) : null}

            <div>
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Riwayat
              </h5>
              <RequestTimeline events={data.events} />
            </div>

            {claimError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {claimError}
              </div>
            ) : null}

            {request.status === "PENDING_APPROVAL" && canApprove ? (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                {canClaim ? (
                  <Button
                    variant="secondary"
                    loading={claiming}
                    disabled={claiming}
                    onClick={handleClaim}
                  >
                    Klaim Persetujuan
                  </Button>
                ) : null}
                <Button
                  variant="danger"
                  disabled={needsClaimFirst(request)}
                  title={
                    needsClaimFirst(request)
                      ? claimFirstTooltip(request)
                      : undefined
                  }
                  onClick={() => setDecisionAction("REJECTED")}
                >
                  Tolak
                </Button>
                <Button
                  disabled={needsClaimFirst(request)}
                  title={
                    needsClaimFirst(request)
                      ? claimFirstTooltip(request)
                      : undefined
                  }
                  onClick={() => setDecisionAction("APPROVED")}
                >
                  Setujui
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      {decisionAction && request ? (
        <RequestDecisionDialog
          request={request}
          action={decisionAction}
          onClose={() => setDecisionAction(null)}
          onDecided={() => {
            setDecisionAction(null);
            onClose();
            onDecided?.();
          }}
        />
      ) : null}
    </>
  );
}

function DecisionSummary({ request }: { request: RequestDto }) {
  const d = request.decision;
  if (!d) return null;
  return (
    <dl className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-slate-500">Keputusan</dt>
        <dd className="text-right font-medium text-slate-700">{requestStatusLabel(d.action)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-slate-500">Penyetuju</dt>
        <dd className="text-right font-mono text-xs text-slate-600">
          {d.actorId ? shortId(d.actorId) : "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-slate-500">Komentar</dt>
        <dd className="text-right font-medium text-slate-700">
          {d.comment || "Tanpa alasan"}
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-slate-500">Diputuskan</dt>
        <dd className="text-right text-slate-600">
          {d.decidedAt ? new Date(d.decidedAt).toLocaleString() : "—"}
        </dd>
      </div>
    </dl>
  );
}

function PayloadSummary({
  request,
  names,
  sicknessNames,
}: {
  request: RequestDto;
  names: Record<string, string>;
  sicknessNames: Record<string, string>;
}) {
  const p = request.payload as Record<string, unknown>;
  const entries = Object.entries(p).filter(([key]) => !isInternalPayloadKey(key));
  return (
    <dl className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-4">
          <dt className="text-slate-500">{payloadLabel(key)}</dt>
          <dd className="text-right font-medium text-slate-700">
            {payloadDisplayValue(p, key, value, names, sicknessNames)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function summaryLabel(
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

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
