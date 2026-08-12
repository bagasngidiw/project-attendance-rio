/**
 * PersonalDashboard — FR-025 personal surface: attendance status, request
 * summary, recent requests, and quick actions (permission-gated).
 */

import { useQuery } from "@tanstack/react-query";

import { dashboardApi } from "@/lib/axios";
import { Spinner } from "@/components/ui/Spinner";

import { AttendanceStatusCard } from "./AttendanceStatusCard";
import { RequestSummaryCard } from "./RequestSummaryCard";
import { RecentRequestsList } from "./RecentRequestsList";
import { QuickActions } from "./QuickActions";

export function PersonalDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard-me"],
    queryFn: () => dashboardApi.me().then((r) => r.data.data),
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Memuat dasbor Anda..." />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Gagal memuat dasbor Anda.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Dasbor</h2>
        <p className="text-sm text-slate-500">Absensi dan permintaan Anda sekilas.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceStatusCard today={data.attendanceToday} />
        <RequestSummaryCard summary={data.requestSummary} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentRequestsList requests={data.recentRequests} />
        <QuickActions actions={data.quickActions} />
      </div>

      <button
        onClick={() => refetch()}
        className="text-xs text-slate-400 underline-offset-2 hover:underline"
      >
        Muat ulang dasbor
      </button>
    </div>
  );
}
