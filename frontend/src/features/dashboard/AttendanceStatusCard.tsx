/**
 * AttendanceStatusCard — today's clocked in/out state with a quick clock
 * action (FR-025 §6.2). The clock-out action is gated by permission.
 */

import { useNavigate } from "react-router-dom";

import type { AttendanceTodayDto } from "@contracts/dashboard";
import { PERMISSIONS } from "@contracts/permissions";

import { Can } from "@/features/auth/Can";
import { attendanceStatusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/constants/routes";

export function AttendanceStatusCard({ today }: { today: AttendanceTodayDto }) {
  const navigate = useNavigate();

  const styles: Record<string, string> = {
    CLOCKED_IN: "bg-green-50 text-green-700",
    CLOCKED_OUT: "bg-slate-100 text-slate-600",
    NOT_STARTED: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Hari ini
          </p>
          <p className="mt-1 text-2xl font-bold">
            {today.status === "CLOCKED_IN"
              ? "Absen masuk"
              : today.status === "CLOCKED_OUT"
                ? "Absen keluar"
                : "Belum mulai"}
          </p>
          {today.clockInAt ? (
            <p className="mt-1 text-xs text-slate-500">
              Masuk pada {new Date(today.clockInAt).toLocaleTimeString()}
              {today.clockOutAt
                ? ` · keluar pada ${new Date(today.clockOutAt).toLocaleTimeString()}`
                : ""}
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${styles[today.status] ?? "bg-slate-100 text-slate-600"}`}
        >
          {attendanceStatusLabel(today.status)}
        </span>
      </div>
      <div className="mt-4">
        <Can permission={PERMISSIONS.ATTENDANCE_CLOCK_IN}>
          <Button
            size="sm"
            disabled={today.status === "CLOCKED_IN"}
            onClick={() => navigate(ROUTES.ATTENDANCE)}
          >
            Absen Masuk
          </Button>
        </Can>
      </div>
    </div>
  );
}
