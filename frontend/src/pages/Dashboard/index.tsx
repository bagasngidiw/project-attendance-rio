/**
 * Dashboard page (FR-025 / FR-026) — role-aware shell: HR/SUPER see the
 * company dashboard; everyone else sees the personal dashboard.
 */

import { PERMISSIONS } from "@contracts/permissions";

import { usePermission } from "@/features/auth/usePermission";
import { PersonalDashboard } from "@/features/dashboard/PersonalDashboard";
import { HrDashboard } from "@/features/dashboard/HrDashboard";

export default function Dashboard() {
  const { hasPermission } = usePermission();
  const canViewHr =
    hasPermission(PERMISSIONS.ATTENDANCE_VIEW_ALL) ||
    hasPermission(PERMISSIONS.REPORTING_VIEW);

  return canViewHr ? <HrDashboard /> : <PersonalDashboard />;
}
