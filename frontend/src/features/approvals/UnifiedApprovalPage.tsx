/**
 * UnifiedApprovalPage — FR-063 unified single-approver approval surface.
 * Pending tab queries GET /approvals (scope = assigned/delegated/view_all);
 * History tab queries GET /approvals/history. Rows support drill-down,
 * approve/reject (FR-002 engine), claim for role-targeted requests (FR-008),
 * and escalation.
 */

import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import type { DecisionAction, UnifiedApprovalStatus } from "@contracts/approvals";
import type { RequestDto, RequestType } from "@contracts/requests";
import { PERMISSIONS, type PermissionKey } from "@contracts/permissions";

import { approvalApi, requestApi } from "@/lib/axios";
import { toast } from "@/lib/toast";
import { apiErrorMessage } from "@/lib/apiError";
import { requestStatusLabel, requestTypeLabel } from "@/lib/labels";
import { useLeaveTypeNames, leaveSummaryName, useSicknessTypeNames, sicknessSummaryName } from "@/features/requests/useLeaveTypeNames";
import { useAuth } from "@/features/auth/useAuth";
import { usePermission } from "@/features/auth/usePermission";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { claimFirstTooltip, needsClaimFirst } from "@/features/approvals/claimable";

import { RequestDrillDownDialog } from "./RequestDrillDownDialog";
import { RequestDecisionDialog } from "./RequestDecisionDialog";
import { EscalateDialog } from "./EscalateDialog";

const PAGE_SIZE = 10;

type Tab = "pending" | "history";

const APPROVE_BY_TYPE: Record<RequestType, PermissionKey> = {
  LEAVE: PERMISSIONS.LEAVE_APPROVE,
  OVERTIME: PERMISSIONS.OVERTIME_APPROVE,
  TRIP: PERMISSIONS.TRIP_APPROVE,
  PERMISSION: PERMISSIONS.PERMISSION_APPROVE,
  SAKIT: PERMISSIONS.SAKIT_APPROVE,
};

const APPROVE_ANY: PermissionKey[] = [
  PERMISSIONS.LEAVE_APPROVE,
  PERMISSIONS.OVERTIME_APPROVE,
  PERMISSIONS.TRIP_APPROVE,
  PERMISSIONS.PERMISSION_APPROVE,
  PERMISSIONS.SAKIT_APPROVE,
];

interface AppliedFilters {
  type?: RequestType;
  status?: UnifiedApprovalStatus;
  employeeId?: string;
  from?: string;
  to?: string;
}

export function UnifiedApprovalPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<AppliedFilters>({ status: "PENDING" });
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [decision, setDecision] = useState<{
    request: RequestDto;
    action: DecisionAction;
  } | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<RequestDto | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const anyApprove = hasPermission(APPROVE_ANY);

  const params = useMemo(
    () => ({ ...applied, page, pageSize: PAGE_SIZE }),
    [applied, page]
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["unified-approvals", tab, params],
    queryFn: () =>
      tab === "pending"
        ? approvalApi.unified(params).then((r) => r.data.data)
        : approvalApi.history(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function switchTab(next: Tab) {
    setTab(next);
    setStatus("");
    setApplied(next === "pending" ? { status: "PENDING" } : {});
    setPage(1);
  }

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setApplied({
      type: (type || undefined) as RequestType | undefined,
      status:
        tab === "pending"
          ? "PENDING"
          : ((status || undefined) as UnifiedApprovalStatus | undefined),
      employeeId: employeeId || undefined,
      from: from || undefined,
      to: to || undefined,
    });
    setPage(1);
  }

  function canDecide(request: RequestDto): boolean {
    return (
      request.status === "PENDING_APPROVAL" &&
      hasPermission(APPROVE_BY_TYPE[request.type])
    );
  }

  /** FR-008: role-targeted PENDING requests can be claimed by an eligible approver. */
  function canClaim(request: RequestDto): boolean {
    return (
      request.status === "PENDING_APPROVAL" &&
      request.approval?.targetType === "ROLE" &&
      request.approval.assignedUserId == null &&
      hasPermission(APPROVE_BY_TYPE[request.type])
    );
  }

  async function handleClaim(request: RequestDto) {
    setClaimingId(request.id);
    try {
      await requestApi.claim(request.id);
      toast.success("Permintaan diklaim. Anda kini penyetuju yang ditugaskan.");
    } catch (err) {
      const message = apiErrorMessage(err);
      if (
        axios.isAxiosError(err) &&
        (err.response?.status === 409 || err.response?.status === 403)
      ) {
        toast.error(
          message || "Tidak dapat mengklaim permintaan ini. Mungkin sudah diklaim."
        );
      } else {
        toast.error(message || "Tidak dapat mengklaim permintaan ini saat ini.");
      }
    } finally {
      setClaimingId(null);
      refetch();
    }
  }

  function canEscalate(request: RequestDto): boolean {
    return (
      request.status === "PENDING_APPROVAL" &&
      (request.requesterId === user?.id || anyApprove)
    );
  }

  function handleDecided() {
    setDecision(null);
    refetch();
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Persetujuan</h2>
        <p className="text-sm text-slate-500">
          Tinjau dan putuskan permintaan cuti, lembur, perjalanan dinas, ijin,
          dan sakit.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-1 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-1">
        <TabButton active={tab === "pending"} onClick={() => switchTab("pending")}>
          Menunggu
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => switchTab("history")}>
          Riwayat
        </TabButton>
      </div>

      <form
        onSubmit={applyFilters}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4"
      >
        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Jenis
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Semua jenis</option>
            <option value="LEAVE">Cuti</option>
            <option value="OVERTIME">Lembur</option>
            <option value="TRIP">Perjalanan Dinas</option>
            <option value="PERMISSION">Ijin</option>
            <option value="SAKIT">Sakit</option>
          </select>
        </div>

        {tab === "pending" ? (
          <div className="w-full sm:w-40">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
              value="PENDING"
              disabled
            >
              <option value="PENDING">Menunggu</option>
            </select>
          </div>
        ) : (
          <div className="w-full sm:w-40">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Semua</option>
              <option value="APPROVED">Disetujui</option>
              <option value="REJECTED">Ditolak</option>
            </select>
          </div>
        )}

        <div className="w-full sm:w-56">
          <Input
            label="ID karyawan"
            placeholder="ID pengguna"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Input
            type="date"
            label="Dari"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Input
            type="date"
            label="Sampai"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button type="submit" size="md">
          Terapkan filter
        </Button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat permintaan..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat permintaan.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          {tab === "pending"
            ? "Tidak ada permintaan yang menunggu keputusan Anda."
            : "Tidak ada keputusan yang sesuai dengan filter saat ini."}
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3">Pemohon</th>
                  <th className="px-4 py-3">Permintaan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">
                    {tab === "pending" ? "Dikirim" : "Diputuskan"}
                  </th>
                  <th className="px-4 py-3">Penyetuju</th>
                  {tab === "history" ? <th className="px-4 py-3">Komentar</th> : null}
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((request) => (
                  <tr key={request.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs font-medium">{requestTypeLabel(request.type)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {request.requesterName ?? shortId(request.requesterId)}
                    </td>
                    <td className="px-4 py-3">
                      <SummaryCell request={request} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={request.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatDate(
                        tab === "pending"
                          ? request.submittedAt
                          : request.decidedAt ?? request.decision?.decidedAt
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {request.approverName ?? (request.approverId ? shortId(request.approverId) : "—")}
                    </td>
                    {tab === "history" ? (
                      <td className="max-w-56 truncate px-4 py-3 text-xs text-slate-600">
                        {decisionSummary(request)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDetailId(request.id)}
                        >
                          Lihat
                        </Button>
                        {canEscalate(request) ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEscalateTarget(request)}
                          >
                            Eskalasi
                          </Button>
                        ) : null}
                        {canClaim(request) ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={claimingId === request.id}
                            disabled={claimingId !== null}
                            onClick={() => handleClaim(request)}
                          >
                            Ambil / Klaim
                          </Button>
                        ) : null}
                        {canDecide(request) ? (
                          <>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={needsClaimFirst(request)}
                              title={
                                needsClaimFirst(request)
                                  ? claimFirstTooltip(request)
                                  : undefined
                              }
                              onClick={() =>
                                setDecision({ request, action: "REJECTED" })
                              }
                            >
                              Tolak
                            </Button>
                            <Button
                              size="sm"
                              disabled={needsClaimFirst(request)}
                              title={
                                needsClaimFirst(request)
                                  ? claimFirstTooltip(request)
                                  : undefined
                              }
                              onClick={() =>
                                setDecision({ request, action: "APPROVED" })
                              }
                            >
                              Setujui
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} permintaan</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Sebelumnya
              </button>
              <span>
                Halaman {page} dari {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}

      {detailId ? (
        <RequestDrillDownDialog
          requestId={detailId}
          onClose={() => setDetailId(null)}
          onDecided={() => {
            setDetailId(null);
            refetch();
          }}
        />
      ) : null}

      {decision ? (
        <RequestDecisionDialog
          request={decision.request}
          action={decision.action}
          onClose={() => setDecision(null)}
          onDecided={handleDecided}
        />
      ) : null}

      {escalateTarget ? (
        <EscalateDialog
          request={escalateTarget}
          onClose={() => setEscalateTarget(null)}
          onEscalated={() => {
            setEscalateTarget(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white"
          : "rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
      }
    >
      {children}
    </button>
  );
}

function SummaryCell({ request }: { request: RequestDto }) {
  const names = useLeaveTypeNames();
  const sicknessNames = useSicknessTypeNames();
  const p = request.payload as Record<string, string>;
  if (request.type === "LEAVE") {
    return (
      <div>
        <p className="font-medium">{leaveSummaryName(p, names)}</p>
        <p className="text-xs text-slate-500">{p.startDate} → {p.endDate}</p>
      </div>
    );
  }
  if (request.type === "OVERTIME") {
    return (
      <div>
        <p className="font-medium">Lembur</p>
        <p className="text-xs text-slate-500">{p.date} · {p.startTime}–{p.endTime}</p>
      </div>
    );
  }
  if (request.type === "PERMISSION") {
    return (
      <div>
        <p className="font-medium">Ijin</p>
        <p className="text-xs text-slate-500">
          {p.date ? p.date : `${p.startDate} → ${p.endDate}`}
        </p>
      </div>
    );
  }
  if (request.type === "SAKIT") {
    const name = sicknessSummaryName(p, sicknessNames);
    const range = p.endDate && p.endDate !== p.startDate
      ? `${p.startDate} → ${p.endDate}`
      : p.startDate;
    return (
      <div>
        <p className="font-medium">{name || "Sakit"}</p>
        <p className="text-xs text-slate-500">{range}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-medium">{p.destination}</p>
      <p className="text-xs text-slate-500">{p.startDate} → {p.endDate}</p>
    </div>
  );
}

/** Decision summary with the FR-063 "No reason provided" fallback. */
function decisionSummary(request: RequestDto): string {
  const d = request.decision;
  if (!d) return "—";
  if (d.comment) return `${requestStatusLabel(d.action)} — ${d.comment}`;
  return d.action === "REJECTED"
    ? "Ditolak — tanpa alasan"
    : requestStatusLabel(d.action);
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
