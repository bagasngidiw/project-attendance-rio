/**
 * NavigationService unit tests (FR-003): filtered grouped navigation tree +
 * bulk permission checks. Groups render only when at least one child is
 * visible; empty groups are pruned.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNavigationFor,
  checkPermissions,
  canView,
  NAVIGATION_CATALOG,
} = require("../../src/application/navigation.service");

const EMPLOYEE_PERMS = [
  "dashboard:view",
  "profile:view",
  "profile:update",
  "attendance:clock_in",
  "attendance:clock_out",
  "attendance:view_own",
  "overtime:submit",
  "overtime:view_own",
  "trip:submit",
  "trip:view_own",
  "leave:submit",
  "leave:view_own",
];

/** Flattens the grouped tree into a plain label list. */
function flatten(nav) {
  const out = [];
  for (const node of nav) {
    out.push(node.label);
    out.push(...flatten(node.children ?? []));
  }
  return out;
}

/** Finds a node by id anywhere in the grouped tree. */
function findNode(nav, id) {
  for (const node of nav) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

test("catalog references only registered permission keys", () => {
  const { assertRegisteredPermission } = require("../../src/domain/permissions");
  assert.doesNotThrow(() => {
    for (const node of NAVIGATION_CATALOG) {
      node.anyOf.forEach(assertRegisteredPermission);
      (node.children ?? []).forEach((child) => child.anyOf.forEach(assertRegisteredPermission));
    }
  });
});

test("employee sees only permitted modules, grouped; empty groups are pruned", () => {
  const nav = buildNavigationFor(EMPLOYEE_PERMS);
  const labels = flatten(nav);

  assert.deepEqual(labels, [
    "INFORMASI",
    "Dasbor",
    "Permintaan Saya",
    "Notifikasi",
    "KARYAWAN",
    "Absensi",
    "Lembur",
    "Perjalanan Dinas",
    "Perijinan",
    "Cuti",
    "SISTEM",
    "Profil",
  ]);
  assert.ok(!labels.includes("Pengguna"));
  assert.ok(!labels.includes("Laporan"));
  assert.ok(!labels.includes("Peran & Izin"));
  assert.ok(!labels.includes("Persetujuan"));
  assert.ok(!labels.includes("MANAJEMEN"), "empty group pruned");
  assert.ok(!labels.includes("PERSETUJUAN"), "empty group pruned");
});

test("super admin wildcard sees every group with all children", () => {
  const nav = buildNavigationFor(["*"]);
  const groupLabels = nav.map((n) => n.label);
  assert.deepEqual(groupLabels, [
    "INFORMASI",
    "KARYAWAN",
    "MANAJEMEN",
    "PERSETUJUAN",
    "LAPORAN",
    "ADMINISTRASI",
    "SISTEM",
  ]);
  // Every catalog leaf is reachable under its group.
  const labels = flatten(nav);
  for (const expected of ["Dasbor", "Absensi", "Lembur", "Perjalanan Dinas", "Cuti", "Ijin", "Sakit", "Pengguna", "Laporan", "Peran & Izin", "Profil", "Master Data"]) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
  // FR-005: the nested Perijinan group is present with its three leaves.
  const karyawan = nav.find((n) => n.id === "group.karyawan");
  const perijinan = karyawan.children.find((c) => c.id === "nav.permissions");
  assert.ok(perijinan, "nested Perijinan group present");
  assert.deepEqual(
    perijinan.children.map((c) => c.id).sort(),
    ["nav.leave", "nav.permission", "nav.sakit"]
  );
});

test("partially permitted modules still render under their group", () => {
  const nav = buildNavigationFor(EMPLOYEE_PERMS);
  const attendance = findNode(nav, "nav.attendance");
  assert.ok(attendance, "employee sees attendance module");
  assert.equal(attendance.path, "/attendance");
});

test("manager sees team-scoped modules", () => {
  const perms = [
    ...EMPLOYEE_PERMS,
    "attendance:view_all",
    "leave:view_all",
    "leave:review",
    "leave:approve",
    "team:view_team",
    "team:view_pending",
  ];
  const nav = buildNavigationFor(perms);
  assert.ok(findNode(nav, "nav.attendance"), "manager still sees attendance module");
  const labels = flatten(nav);
  // FR-003: with the My Team / Organization leaves removed and no users:view,
  // the MANAJEMEN group is pruned entirely.
  assert.ok(!labels.includes("MANAJEMEN"), "MANAJEMEN pruned (no visible children)");
  assert.ok(!labels.includes("Tim Saya"));
  assert.ok(!labels.includes("Organisasi"));
});

test("approvals group is visible to approve holders and hidden from employees (FR-063)", () => {
  const approverNav = buildNavigationFor([...EMPLOYEE_PERMS, "leave:approve"]);
  assert.ok(
    findNode(approverNav, "nav.approvals"),
    "approve holder sees the unified Approvals node"
  );
  assert.ok(
    findNode(approverNav, "nav.approval_inbox"),
    "approve holder sees the approval inbox"
  );
  const labels = flatten(approverNav);
  assert.ok(labels.includes("PERSETUJUAN"));

  const employeeNav = buildNavigationFor(EMPLOYEE_PERMS);
  assert.ok(
    !findNode(employeeNav, "nav.approvals"),
    "employee without approve permission never sees Approvals"
  );
  assert.ok(!flatten(employeeNav).includes("PERSETUJUAN"));
});

test("HR admin sees administrative modules including read-only RBAC console (E2 + D3)", () => {
  const perms = [
    ...EMPLOYEE_PERMS,
    "attendance:view_all",
    "attendance:correct",
    "users:view",
    "users:create",
    "users:edit",
    "users:deactivate",
    "users:reset_password",
    "users:assign_roles",
    "org:manage_departments",
    "org:manage_positions",
    "reporting:view",
    "reporting:export_excel",
    "reporting:export_pdf",
    "rbac:view_roles",
    "rbac:view_permissions",
    "audit:view",
  ];
  const nav = buildNavigationFor(perms);
  const labels = flatten(nav);
  assert.ok(labels.includes("Pengguna"), "HR admin sees Users");
  assert.ok(labels.includes("Laporan"), "HR admin sees Reports");
  assert.ok(
    labels.includes("Peran & Izin"),
    "HR admin with rbac:view_roles sees the console read-only"
  );
  // FR-003/FR-004: Audit Log / Activity Log / Organisasi menus are removed
  // even though the user holds their permissions.
  assert.ok(!labels.includes("Log Audit"), "Audit Log menu removed");
  assert.ok(!labels.includes("Log Aktivitas"), "Activity Log menu removed");
  assert.ok(!labels.includes("Organisasi"), "Organization menu removed");
  assert.ok(!labels.includes("Tim Saya"), "My Team menu removed");
});

test("HR admin without rbac:view_roles never sees the RBAC console", () => {
  const nav = buildNavigationFor([
    ...EMPLOYEE_PERMS,
    "users:view",
    "reporting:view",
    "audit:view",
  ]);
  const labels = flatten(nav);
  assert.ok(!labels.includes("Peran & Izin"));
});

test("employee without team permissions never sees the My Team node", () => {
  const nav = buildNavigationFor(EMPLOYEE_PERMS);
  assert.ok(!flatten(nav).includes("Tim Saya"));
});

test("FR-005: nested group prunes when none of its leaves are visible", () => {
  // A user with no leave/permission/sakit access never sees Perijinan.
  const nav = buildNavigationFor(["dashboard:view", "profile:view"]);
  assert.ok(!findNode(nav, "nav.permissions"), "nested group pruned when empty");
  const labels = flatten(nav);
  assert.ok(!labels.includes("Perijinan"));
  assert.ok(!labels.includes("Cuti"));

  // Partial visibility keeps the nested group with only the visible leaves.
  const partial = buildNavigationFor([
    ...EMPLOYEE_PERMS.slice(0, 4),
    "leave:submit",
  ]);
  const perijinan = findNode(partial, "nav.permissions");
  assert.ok(perijinan, "nested group kept when at least one leaf is visible");
  const childLabels = perijinan.children.map((c) => c.label);
  assert.deepEqual(childLabels, ["Cuti"]);
});

test("FR-005: nested group renders under its parent group with icons resolved", () => {
  const nav = buildNavigationFor(EMPLOYEE_PERMS);
  const karyawan = nav.find((n) => n.id === "group.karyawan");
  const perijinan = karyawan.children.find((c) => c.id === "nav.permissions");
  assert.equal(perijinan.path, null, "group nodes carry no path");
  assert.equal(perijinan.children[0].icon, "calendar-days", "leaf icons preserved");
});

test("user with no permissions gets an empty tree", () => {
  assert.deepEqual(buildNavigationFor([]), []);
});

test("navigation payload is serializable and contains expected fields", () => {
  const nav = buildNavigationFor(EMPLOYEE_PERMS);
  const dashboard = findNode(nav, "nav.dashboard");
  assert.deepEqual(dashboard, {
    id: "nav.dashboard",
    label: "Dasbor",
    path: "/dashboard",
    icon: "layout-dashboard",
    children: [],
  });

  const group = nav.find((n) => n.id === "group.informasi");
  assert.equal(group.label, "INFORMASI");
  assert.equal(group.path, null);
  assert.ok(group.children.some((c) => c.id === "nav.dashboard"));
});

test("canView handles wildcard and anyOf", () => {
  assert.equal(canView(["leave:submit"], ["leave:submit", "leave:approve"]), true);
  assert.equal(canView(["dashboard:view"], ["leave:submit", "leave:approve"]), false);
  assert.equal(canView(["*"], ["rbac:manage_roles"]), true);
});

test("checkPermissions evaluates each requested key with wildcard", () => {
  const results = checkPermissions(
    ["leave:submit", "dashboard:view"],
    ["leave:submit", "leave:approve", "dashboard:view"]
  );
  assert.deepEqual(results, [
    { key: "leave:submit", granted: true },
    { key: "leave:approve", granted: false },
    { key: "dashboard:view", granted: true },
  ]);

  const wildcard = checkPermissions(["*"], ["attendance:correct", "users:create"]);
  assert.deepEqual(wildcard, [
    { key: "attendance:correct", granted: true },
    { key: "users:create", granted: true },
  ]);
});

test("checkPermissions dedupes duplicate keys", () => {
  const results = checkPermissions(["a:b"], ["a:b", "a:b"]);
  assert.equal(results.length, 1);
});
