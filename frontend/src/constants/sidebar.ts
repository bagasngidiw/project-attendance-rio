import {
  Home,
  Clock3,
  CalendarDays,
  CalendarCheck2,
  Plane,
  FileText,
  Users,
  User,
  BarChart3,
  ShieldCheck,
  Settings,
  ScrollText,
  Inbox,
  History,
  ListChecks,
  Bell,
  Stethoscope,
  Database,
} from "lucide-react";

import { PERMISSIONS } from "@contracts/permissions";

import type { SidebarItem } from "@/types/sidebar";

/**
 * Central navigation definition, driven by permissions rather than roles.
 * Each leaf renders only when the signed-in user holds at least one of its
 * required permissions (FR-003 foundation). Groups (INFORMASI, KARYAWAN, ...)
 * render as section labels and are pruned when none of their children are
 * visible — the server navigation tree is the single source of truth; this
 * catalog supplies icons and the offline fallback.
 */
export const MENU: SidebarItem[] = [
  {
    title: "INFORMASI",
    children: [
      {
        title: "Dasbor",
        path: "/dashboard",
        icon: Home,
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
      },
      {
        title: "Permintaan Saya",
        path: "/my-requests",
        icon: ScrollText,
        permissions: [
          PERMISSIONS.LEAVE_VIEW_OWN,
          PERMISSIONS.OVERTIME_VIEW_OWN,
          PERMISSIONS.TRIP_VIEW_OWN,
          PERMISSIONS.SAKIT_VIEW_OWN,
        ],
      },
      {
        title: "Notifikasi",
        path: "/notifications",
        icon: Bell,
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
      },
    ],
  },

  {
    title: "KARYAWAN",
    children: [
      {
        title: "Absensi",
        path: "/attendance",
        icon: Clock3,
        permissions: [
          PERMISSIONS.ATTENDANCE_CLOCK_IN,
          PERMISSIONS.ATTENDANCE_VIEW_OWN,
          PERMISSIONS.ATTENDANCE_VIEW_ALL,
        ],
      },
      {
        title: "Lembur",
        path: "/overtime",
        icon: CalendarDays,
        permissions: [
          PERMISSIONS.OVERTIME_SUBMIT,
          PERMISSIONS.OVERTIME_VIEW_OWN,
          PERMISSIONS.OVERTIME_VIEW_ALL,
        ],
      },
      {
        title: "Perjalanan Dinas",
        path: "/business-trip",
        icon: Plane,
        permissions: [
          PERMISSIONS.TRIP_SUBMIT,
          PERMISSIONS.TRIP_VIEW_OWN,
          PERMISSIONS.TRIP_VIEW_ALL,
        ],
      },
      // FR-005: parent "Perijinan" group nests Cuti / Ijin / Sakit.
      {
        title: "Perijinan",
        children: [
          {
            title: "Cuti",
            path: "/leave",
            icon: FileText,
            permissions: [
              PERMISSIONS.LEAVE_SUBMIT,
              PERMISSIONS.LEAVE_VIEW_OWN,
              PERMISSIONS.LEAVE_VIEW_ALL,
            ],
          },
          {
            title: "Ijin",
            path: "/permission",
            icon: CalendarCheck2,
            permissions: [
              PERMISSIONS.PERMISSION_SUBMIT,
              PERMISSIONS.PERMISSION_VIEW_OWN,
              PERMISSIONS.PERMISSION_VIEW_ALL,
            ],
          },
          {
            title: "Sakit",
            path: "/sakit",
            icon: Stethoscope,
            permissions: [
              PERMISSIONS.SAKIT_SUBMIT,
              PERMISSIONS.SAKIT_VIEW_OWN,
              PERMISSIONS.SAKIT_VIEW_ALL,
            ],
          },
        ],
      },
    ],
  },

  {
    title: "MANAJEMEN",
    children: [
      {
        title: "Pengguna",
        path: "/users",
        icon: Users,
        permissions: [PERMISSIONS.USERS_VIEW],
      },
    ],
  },

  {
    title: "PERSETUJUAN",
    children: [
      {
        title: "Persetujuan",
        path: "/approvals",
        icon: ListChecks,
        permissions: [
          PERMISSIONS.LEAVE_APPROVE,
          PERMISSIONS.OVERTIME_APPROVE,
          PERMISSIONS.TRIP_APPROVE,
          PERMISSIONS.PERMISSION_APPROVE,
          PERMISSIONS.SAKIT_APPROVE,
        ],
      },
      {
        title: "Kotak Masuk Persetujuan",
        path: "/admin/approvals",
        icon: Inbox,
        permissions: [
          PERMISSIONS.LEAVE_APPROVE,
          PERMISSIONS.OVERTIME_APPROVE,
          PERMISSIONS.TRIP_APPROVE,
          PERMISSIONS.PERMISSION_APPROVE,
          PERMISSIONS.SAKIT_APPROVE,
        ],
      },
      {
        title: "Riwayat Persetujuan",
        path: "/admin/approval-history",
        icon: History,
        permissions: [
          PERMISSIONS.LEAVE_APPROVE,
          PERMISSIONS.OVERTIME_APPROVE,
          PERMISSIONS.TRIP_APPROVE,
          PERMISSIONS.PERMISSION_APPROVE,
          PERMISSIONS.SAKIT_APPROVE,
        ],
      },
    ],
  },

  {
    title: "LAPORAN",
    children: [
      {
        title: "Laporan",
        path: "/reports",
        icon: BarChart3,
        permissions: [PERMISSIONS.REPORTING_VIEW],
      },
    ],
  },

  {
    title: "ADMINISTRASI",
    children: [
      {
        title: "Peran & Izin",
        path: "/admin/rbac",
        icon: ShieldCheck,
        permissions: [PERMISSIONS.RBAC_VIEW_ROLES],
      },
      {
        title: "Konfigurasi Persetujuan",
        path: "/admin/approval-config",
        icon: ListChecks,
        permissions: [PERMISSIONS.APPROVAL_CONFIG_MANAGE],
      },
      {
        title: "Master Data",
        path: "/admin/master",
        icon: Database,
        permissions: [PERMISSIONS.PLATFORM_SETTINGS],
      },
    ],
  },

  {
    title: "SISTEM",
    children: [
      {
        title: "Platform Settings",
        path: "/admin/settings",
        icon: Settings,
        permissions: [PERMISSIONS.PLATFORM_SETTINGS],
      },
      {
        title: "Profil",
        path: "/profile",
        icon: User,
        permissions: [PERMISSIONS.PROFILE_VIEW],
      },
    ],
  },
];
