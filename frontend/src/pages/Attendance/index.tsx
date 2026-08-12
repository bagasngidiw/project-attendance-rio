/**
 * Attendance page (FR-035 / FR-041) — role-aware: HR sees the overview with
 * corrections; employees see the clock panel + personal history.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { PERMISSIONS } from "@contracts/permissions";

import { usePermission } from "@/features/auth/usePermission";
import { AttendanceVerificationPanel } from "@/features/attendance/AttendanceVerificationPanel";
import { MyAttendanceHistory } from "@/features/attendance/MyAttendanceHistory";
import { AttendanceOverview } from "@/features/attendance/AttendanceOverview";

export default function Attendance() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canViewAll = hasPermission(PERMISSIONS.ATTENDANCE_VIEW_ALL);

  // Clock/correction mutations invalidate today + history + overview so all
  // surfaces reflect the new state immediately.
  const onChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
    queryClient.invalidateQueries({ queryKey: ["attendance-me"] });
    queryClient.invalidateQueries({ queryKey: ["attendance-overview"] });
  }, [queryClient]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Absensi</h2>
        <p className="text-sm text-slate-500">
          {canViewAll
            ? "Kelola absensi dalam lingkup Anda dan selesaikan pengecualian."
            : "Absen masuk dan keluar serta tinjau riwayat pribadi Anda."}
        </p>
      </div>

      {canViewAll ? (
        <AttendanceOverview />
      ) : (
        <>
          <AttendanceVerificationPanel onChanged={onChanged} />
          <MyAttendanceHistory />
        </>
      )}
    </div>
  );
}
