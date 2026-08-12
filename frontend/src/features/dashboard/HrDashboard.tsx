/**
 * HrDashboard — FR-026 HR statistics: workforce, attendance summary, pending
 * requests, department breakdown, and recent approvals.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { HrDashboardDto } from "@contracts/dashboard";

import { dashboardApi } from "@/lib/axios";
import { requestTypeLabel } from "@/lib/labels";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { ROUTES } from "@/constants/routes";

import { StatCard } from "./StatCard";

export function HrDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard-hr"],
    queryFn: () => dashboardApi.hr().then((r) => r.data.data),
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat dasbor perusahaan..." />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat dasbor perusahaan.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Dasbor Perusahaan</h2>
          <p className="text-sm text-slate-500">Statistik tenaga kerja dan HR.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-slate-400 underline-offset-2 hover:underline"
        >
          Muat ulang
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Karyawan aktif" value={data.workforce.totalActiveEmployees} />
        <StatCard label="Absen masuk hari ini" value={data.attendanceSummary.clockedInToday} />
        <StatCard label="Belum mulai" value={data.attendanceSummary.notStarted} />
        <StatCard label="Permintaan menunggu" value={data.pendingRequests.total} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* <DepartmentBreakdownCard
          departments={data.workforce.byDepartment}
          exceptions={data.attendanceSummary.exceptions}
        /> */}
        <PendingApprovalsCard
          pending={data.pendingRequests}
          recentApprovals={data.recentApprovals}
        />
      </div>
    </div>
  );
}

// function DepartmentBreakdownCard({
//   departments,
//   exceptions,
// }: {
//   departments: HrDashboardDto["workforce"]["byDepartment"];
//   exceptions: number;
// }) {
//   return (
//     <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
//       <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
//         Karyawan per departemen
//       </p>
//       {departments.length === 0 ? (
//         <p className="text-sm text-slate-500">Belum ada departemen yang dikonfigurasi.</p>
//       ) : (
//         <table className="w-full text-sm">
//           <tbody className="divide-y divide-slate-50">
//             {departments.map((dept, index) => (
//               <tr key={index}>
//                 <td className="py-2 font-medium">{dept.name ?? dept.departmentId ?? "Tanpa departemen"}</td>
//                 <td className="py-2 text-right font-bold">{dept.count}</td>
//               </tr>
//             ))}
//           </tbody>
//         </table>
//       )}
//       <p className="mt-3 text-xs text-slate-400">
//         Pengecualian absensi dalam rentang: <span className="font-semibold">{exceptions}</span>
//       </p>
//     </div>
//   );
// }

function PendingApprovalsCard({
  pending,
  recentApprovals,
}: {
  pending: HrDashboardDto["pendingRequests"];
  recentApprovals: HrDashboardDto["recentApprovals"];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Persetujuan menunggu
        </p>
        <Link
          to={ROUTES.ADMIN_APPROVALS}
          className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
        >
          Buka kotak masuk
        </Link>
      </div>
      <div className="mt-2 flex gap-4 text-sm">
        <span className="text-slate-700">Cuti: {pending.leave}</span>
        <span className="text-slate-700">Lembur: {pending.overtime}</span>
        <span className="text-slate-700">Perjalanan dinas: {pending.trip}</span>
      </div>

      <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
        Keputusan terbaru
      </p>
      {recentApprovals.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada keputusan yang tercatat.</p>
      ) : (
        <ul className="space-y-2">
          {recentApprovals.map((approval) => (
            <li key={approval.id} className="flex items-center justify-between text-sm">
              <span className="truncate">
                {approval.requesterName} · {requestTypeLabel(approval.type)}
              </span>
              <StatusBadge status={approval.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
