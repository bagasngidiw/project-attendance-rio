/**
 * RequestDetailDialog — full request payload + status + approver + decision
 * info and the immutable history timeline (FR-008/FR-009, read-only).
 * Shows WHO approved/rejected (from the event actor snapshots) and the
 * rejection reason.
 */

import { useQuery } from "@tanstack/react-query";

import type { RequestDto, RequestEventDto } from "@contracts/requests";

import { requestApi } from "@/lib/axios";
import {
  isInternalPayloadKey,
  payloadDisplayValue,
  payloadLabel,
  requestTypeLabel,
  requestEventLabel,
} from "@/lib/labels";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "./StatusBadge";
import { RequestTimeline } from "./RequestTimeline";
import { RequestAttachments } from "./RequestAttachments";
import { useLeaveTypeNames, leaveSummaryName, useSicknessTypeNames, sicknessSummaryName } from "./useLeaveTypeNames";

export function RequestDetailDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["request", requestId],
    queryFn: () => requestApi.get(requestId).then((r) => r.data.data),
  });
  const names = useLeaveTypeNames();
  const sicknessNames = useSicknessTypeNames();

  return (
    <Modal title="Detail permintaan" onClose={onClose}>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner label="Memuat permintaan..." />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">Tidak dapat memuat permintaan.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">{requestTypeLabel(data.type)}</p>
              <h4 className="font-semibold">{summaryLabel(data, names, sicknessNames)}</h4>
            </div>
            <StatusBadge status={data.status} />
          </div>

          <PayloadSummary
            request={data}
            names={names}
            sicknessNames={sicknessNames}
          />

          {/* FR-010: supporting documents, authorization-controlled by the backend. */}
          <RequestAttachments requestId={data.id} />

          <ApprovalInfo request={data} />

          <div>
            <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Riwayat
            </h5>
            <RequestTimeline events={data.events ?? []} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Blok "Informasi Persetujuan": siapa yang menyetujui/menolak + kapan + alasan. */
function ApprovalInfo({ request }: { request: RequestDto }) {
  const decisionEvent = (request.events ?? []).find(
    (e: RequestEventDto) => e.event === "APPROVED" || e.event === "REJECTED"
  );

  if (request.status === "PENDING_APPROVAL") {
    const target = request.approval?.configurationSnapshot;
    const targetName =
      target?.targetUserName ??
      target?.targetRoleName ??
      (request.approval?.targetType === "ROLE" ? "Role" : "—");
    return (
      <section className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
        <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Informasi Persetujuan
        </h5>
        <p className="text-slate-600">
          Target persetujuan:{" "}
          <span className="font-medium text-slate-800">{targetName}</span>
          {request.approval?.assignedUserId
            ? " · sudah diklaim/ditugaskan"
            : " · menunggu approver"}
        </p>
      </section>
    );
  }

  if (request.status === "APPROVED" || request.status === "REJECTED") {
    const action = requestEventLabel(decisionEvent?.event);
    const actor = decisionEvent?.actorNameSnapshot ?? null;
    const at = decisionEvent?.recordedAt
      ? new Date(decisionEvent.recordedAt).toLocaleString()
      : request.approval?.approvedAt ?? request.approval?.rejectedAt
        ? new Date(
            (request.approval?.approvedAt ?? request.approval?.rejectedAt) as string
          ).toLocaleString()
        : null;
    const reason = request.approval?.rejectionReason;

    return (
      <section className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
        <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Informasi Persetujuan
        </h5>
        <p className="text-slate-600">
          {action} oleh{" "}
          <span className="font-medium text-slate-800">{actor ?? "—"}</span>
          {at ? <span className="text-slate-400"> · {at}</span> : null}
        </p>
        {reason ? (
          <p className="mt-1 text-slate-600">
            Alasan: <span className="text-slate-800">“{reason}”</span>
          </p>
        ) : null}
      </section>
    );
  }

  return null;
}

function summaryLabel(
  request: RequestDto,
  names: Record<string, string>,
  sicknessNames: Record<string, string>
): string {
  const p = request.payload as Record<string, string>;
  if (request.type === "LEAVE") return `${leaveSummaryName(p, names)} — ${p.startDate} s.d. ${p.endDate}`;
  if (request.type === "OVERTIME") return `Lembur — ${p.date} (${p.startTime}–${p.endTime})`;
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
  return `Perjalanan dinas ke ${p.destination} — ${p.startDate} s.d. ${p.endDate}`;
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
