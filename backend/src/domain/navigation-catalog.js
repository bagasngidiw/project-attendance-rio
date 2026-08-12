/**
 * NavigationCatalog — single source of navigation truth (FR-003).
 *
 * Navigation is organized into logical groups (INFORMASI, KARYAWAN, ...).
 * A group node carries no permission of its own: it is visible when at least
 * one child is visible, and pruned when every child is filtered out (see
 * `buildNavigationFor`). Leaf nodes are keyed by one or more PermissionKeys
 * and render when the user holds ANY of their `anyOf` permissions.
 *
 * The catalog is data, never hard-coded per role. Nodes are validated against
 * the permission registry at boot so orphan keys fail fast (design §2.1).
 */

const { assertRegisteredPermission } = require("./permissions");

const NAVIGATION_CATALOG = Object.freeze([
  // ── INFORMASI ─────────────────────────────────────────────────────────────
  {
    id: "group.informasi",
    label: "INFORMASI",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.dashboard",
        module: "DASHBOARD",
        label: "Dasbor",
        path: "/dashboard",
        icon: "layout-dashboard",
        anyOf: ["dashboard:view"],
        children: [],
      },
      {
        id: "nav.my_requests",
        module: "REQUESTS",
        label: "Permintaan Saya",
        path: "/my-requests",
        icon: "scroll-text",
        anyOf: ["leave:view_own", "overtime:view_own", "trip:view_own", "sakit:view_own"],
        children: [],
      },
      {
        id: "nav.notifications",
        module: "NOTIFICATIONS",
        label: "Notifikasi",
        path: "/notifications",
        icon: "bell",
        anyOf: ["dashboard:view"],
        children: [],
      },
    ],
  },

  // ── KARYAWAN ──────────────────────────────────────────────────────────────
  {
    id: "group.karyawan",
    label: "KARYAWAN",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.attendance",
        module: "ATTENDANCE",
        label: "Absensi",
        path: "/attendance",
        icon: "clock",
        anyOf: [
          "attendance:clock_in",
          "attendance:view_own",
          "attendance:view_all",
        ],
        children: [],
      },
      {
        id: "nav.overtime",
        module: "OVERTIME",
        label: "Lembur",
        path: "/overtime",
        icon: "clock-4",
        anyOf: ["overtime:submit", "overtime:view_own", "overtime:view_all"],
        children: [],
      },
      {
        id: "nav.trip",
        module: "TRIP",
        label: "Perjalanan Dinas",
        path: "/business-trip",
        icon: "plane",
        anyOf: ["trip:submit", "trip:view_own", "trip:view_all"],
        children: [],
      },
      // FR-005: parent "Perijinan" group nests Leave / Permission / Sakit.
      {
        id: "nav.permissions",
        module: "NAV",
        label: "Perijinan",
        path: null,
        icon: null,
        anyOf: [],
        children: [
          {
            id: "nav.leave",
            module: "LEAVE",
            label: "Cuti",
            path: "/leave",
            icon: "calendar-days",
            anyOf: ["leave:submit", "leave:view_own", "leave:view_all"],
            children: [],
          },
          {
            id: "nav.permission",
            module: "PERMISSION",
            label: "Ijin",
            path: "/permission",
            icon: "file-check",
            anyOf: ["permission:submit", "permission:view_own", "permission:view_all"],
            children: [],
          },
          {
            id: "nav.sakit",
            module: "SAKIT",
            label: "Sakit",
            path: "/sakit",
            icon: "thermometer",
            anyOf: ["sakit:submit", "sakit:view_own", "sakit:view_all"],
            children: [],
          },
        ],
      },
    ],
  },

  // ── MANAJEMEN ─────────────────────────────────────────────────────────────
  {
    id: "group.manajemen",
    label: "MANAJEMEN",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.users",
        module: "USERS",
        label: "Pengguna",
        path: "/users",
        icon: "users",
        anyOf: ["users:view"],
        children: [],
      },
    ],
  },

  // ── PERSETUJUAN ───────────────────────────────────────────────────────────
  {
    id: "group.persetujuan",
    label: "PERSETUJUAN",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.approvals",
        module: "APPROVAL",
        label: "Persetujuan",
        path: "/approvals",
        icon: "list-checks",
        // FR-063: the unified approval surface is visible to anyone holding
        // an approve capability for any request type.
        anyOf: [
          "leave:approve",
          "overtime:approve",
          "trip:approve",
          "permission:approve",
          "sakit:approve",
        ],
        children: [],
      },
      {
        id: "nav.approval_inbox",
        module: "APPROVAL",
        label: "Kotak Masuk Persetujuan",
        path: "/admin/approvals",
        icon: "inbox",
        anyOf: [
          "leave:approve",
          "overtime:approve",
          "trip:approve",
          "permission:approve",
          "sakit:approve",
        ],
        children: [],
      },
      {
        id: "nav.approval_history",
        module: "APPROVAL",
        label: "Riwayat Persetujuan",
        path: "/admin/approval-history",
        icon: "history",
        anyOf: [
          "leave:approve",
          "overtime:approve",
          "trip:approve",
          "permission:approve",
          "sakit:approve",
        ],
        children: [],
      },
    ],
  },

  // ── LAPORAN ───────────────────────────────────────────────────────────────
  {
    id: "group.laporan",
    label: "LAPORAN",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.reports",
        module: "REPORTING",
        label: "Laporan",
        path: "/reports",
        icon: "bar-chart-3",
        anyOf: ["reporting:view"],
        children: [],
      },
    ],
  },

  // ── ADMINISTRASI ──────────────────────────────────────────────────────────
  {
    id: "group.administrasi",
    label: "ADMINISTRASI",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.rbac",
        module: "RBAC",
        label: "Peran & Izin",
        path: "/admin/rbac",
        icon: "shield-check",
        anyOf: ["rbac:view_roles"],
        children: [],
      },
      {
        id: "nav.approval_config",
        module: "APPROVAL",
        label: "Konfigurasi Persetujuan",
        path: "/admin/approval-config",
        icon: "list-checks",
        anyOf: ["approval_config:manage"],
        children: [],
      },
      {
        id: "nav.master",
        module: "PLATFORM",
        label: "Master Data",
        path: "/admin/master",
        icon: "database",
        anyOf: ["platform:settings"],
        children: [],
      },
    ],
  },

  // ── SISTEM ────────────────────────────────────────────────────────────────
  {
    id: "group.sistem",
    label: "SISTEM",
    module: "NAV",
    path: null,
    icon: null,
    anyOf: [],
    children: [
      {
        id: "nav.platform_settings",
        module: "PLATFORM",
        label: "Platform Settings",
        path: "/admin/settings",
        icon: "settings",
        anyOf: ["platform:settings"],
        children: [],
      },
      {
        id: "nav.profile",
        module: "PROFILE",
        label: "Profil",
        path: "/profile",
        icon: "user",
        anyOf: ["profile:view"],
        children: [],
      },
    ],
  },
]);

/** Recursively validates every permission key referenced by a node. */
function validateNode(node) {
  node.anyOf.forEach(assertRegisteredPermission);
  (node.children ?? []).forEach(validateNode);
}

// Fail-fast at boot: no orphan navigation permissions.
NAVIGATION_CATALOG.forEach(validateNode);

module.exports = { NAVIGATION_CATALOG };
