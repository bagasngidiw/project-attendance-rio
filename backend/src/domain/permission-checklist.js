/**
 * Permission checklist domain model (FR-064).
 *
 * Groups the permission registry into console-friendly sections, declares the
 * dependency map (warnings, not hard blocks) and the high-privilege warning
 * set, and provides the validation helpers used by the Role Wizard and the
 * `/rbac-admin/roles/:id/validate` endpoint.
 *
 * Pure: no I/O.
 */

const { PERMISSION_REGISTRY } = require("./permissions");

/**
 * Checklist groups (module → label). Extra action groups beyond the registry
 * modules are declared here with the keys they surface.
 */
const CHECKLIST_GROUPS = Object.freeze([
  { key: "DASHBOARD", label: "Dasbor" },
  { key: "ATTENDANCE", label: "Absensi" },
  { key: "LEAVE", label: "Cuti" },
  { key: "PERMISSION", label: "Ijin" },
  { key: "SAKIT", label: "Sakit" },
  { key: "TRIP", label: "Perjalanan Dinas" },
  { key: "OVERTIME", label: "Lembur" },
  { key: "USERS", label: "Manajemen Pengguna" },
  { key: "ORG", label: "Manajemen Departemen & Jabatan" },
  { key: "REPORTING", label: "Laporan" },
  { key: "AUDIT", label: "Log Aktivitas & Audit" },
  { key: "RBAC", label: "Manajemen Peran & Izin" },
  { key: "PLATFORM", label: "Administrasi Sistem" },
  { key: "TEAM", label: "Tim & Delegasi" },
  { key: "PROFILE", label: "Profil & Akun" },
  { key: "FILES", label: "Berkas & Lampiran" },
  { key: "CALENDAR", label: "Kalender" },
  { key: "COMPLIANCE", label: "Kepatuhan" },
]);

/**
 * Dependency map (warnings only). Each entry: when `permission` is granted
 * but NONE of `requires` is granted, the console warns.
 */
const DEPENDENCY_MAP = Object.freeze([
  { permission: "leave:approve", requires: ["leave:view_all"], label: "Menyetujui cuti memerlukan Cuti lihat-semua" },
  { permission: "trip:approve", requires: ["trip:view_all"], label: "Menyetujui perjalanan dinas memerlukan Perjalanan Dinas lihat-semua" },
  { permission: "overtime:approve", requires: ["overtime:view_all"], label: "Menyetujui lembur memerlukan Lembur lihat-semua" },
  { permission: "permission:approve", requires: ["permission:view_all"], label: "Menyetujui ijin memerlukan Ijin lihat-semua" },
  { permission: "sakit:approve", requires: ["sakit:view_all"], label: "Menyetujui sakit memerlukan Sakit lihat-semua" },
  { permission: "approval:delegate", requires: ["leave:approve", "trip:approve", "overtime:approve"], label: "Delegasi memerlukan kapabilitas menyetujui" },
  { permission: "reporting:export_excel", requires: ["reporting:view"], label: "Ekspor Excel memerlukan Laporan lihat" },
  { permission: "reporting:export_pdf", requires: ["reporting:view"], label: "Ekspor PDF memerlukan Laporan lihat" },
  { permission: "reporting:drill_down", requires: ["reporting:view"], label: "Penelusuran laporan memerlukan Laporan lihat" },
  { permission: "rbac:manage_roles", requires: ["rbac:view_roles"], label: "Kelola Peran memerlukan Lihat Peran" },
  { permission: "rbac:manage_permissions", requires: ["rbac:view_permissions"], label: "Kelola Izin memerlukan Lihat Izin" },
  { permission: "users:assign_roles", requires: ["users:view"], label: "Tetapkan Peran memerlukan Pengguna lihat" },
  { permission: "users:import", requires: ["users:create", "users:view"], label: "Impor massal memerlukan kapabilitas manajemen pengguna" },
  { permission: "audit:view", requires: [], label: "Visibilitas audit adalah kapabilitas berhak istimewa tinggi" },
]);

/** Permissions that always surface a high-privilege warning in the wizard. */
const HIGH_PRIVILEGE_PERMISSIONS = Object.freeze([
  "*",
  "rbac:manage_roles",
  "rbac:manage_permissions",
  "users:assign_roles",
  "users:create",
  "users:edit",
  "users:deactivate",
  "users:reset_password",
  "audit:view",
  "platform:settings",
  "platform:modules",
  "platform:override_cutoff",
]);

/**
 * Builds the checklist payload: groups with their registered permission keys.
 *
 * @returns {Array<{ key: string, label: string, permissions: Array<{ key: string, description: string }> }>}
 */
function buildChecklistGroups() {
  return CHECKLIST_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    permissions: (PERMISSION_REGISTRY[group.key] ?? []).map((key) => ({
      key,
      description: describe(key),
    })),
  }));
}

/** Human-readable permission description. */
function describe(key) {
  const [module, action] = key.split(":");
  const actionLabel = (action ?? key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${actionLabel} within ${module}.`;
}

/**
 * Computes dependency warnings for a permission set.
 *
 * @param {string[]} permissions
 * @returns {Array<{ permission: string, requires: string[], label: string }>}
 */
function dependencyWarnings(permissions) {
  const set = new Set(permissions);
  const warnings = [];
  for (const dep of DEPENDENCY_MAP) {
    if (!set.has(dep.permission)) continue;
    const missing = dep.requires.filter((req) => !set.has(req));
    if (missing.length > 0) {
      warnings.push({
        permission: dep.permission,
        requires: missing,
        label: dep.label,
      });
    }
  }
  return warnings;
}

/**
 * Computes high-privilege warnings for a permission set.
 *
 * @param {string[]} permissions
 * @returns {string[]}
 */
function highPrivilegeWarnings(permissions) {
  return permissions.filter((key) => HIGH_PRIVILEGE_PERMISSIONS.includes(key));
}

/**
 * Full validation report used by the Role Wizard before save.
 *
 * @param {{ permissions: string[], level?: number, dataScope?: string }} input
 * @returns {{ groups: object, warnings: { dependencies: object[], highPrivilege: string[] }, preview: object }}
 */
function buildValidationReport({ permissions }) {
  const unique = [...new Set(permissions ?? [])];
  return {
    groups: buildChecklistGroups(),
    warnings: {
      dependencies: dependencyWarnings(unique),
      highPrivilege: highPrivilegeWarnings(unique),
    },
    preview: {
      menuModules: groupByFirstSegment(unique),
      approvalAuthority: unique.filter(
        (key) => key.endsWith(":approve") || key.endsWith(":review")
      ),
      reportPermissions: unique.filter((key) => key.startsWith("reporting:")),
      adminCapabilities: unique.filter((key) =>
        HIGH_PRIVILEGE_PERMISSIONS.includes(key)
      ),
    },
  };
}

function groupByFirstSegment(keys) {
  const map = new Map();
  for (const key of keys) {
    const module = (key.split(":")[0] ?? "").toUpperCase();
    if (!map.has(module)) map.set(module, []);
    map.get(module).push(key);
  }
  return [...map.entries()].map(([module, permissions]) => ({ module, permissions }));
}

module.exports = {
  CHECKLIST_GROUPS,
  DEPENDENCY_MAP,
  HIGH_PRIVILEGE_PERMISSIONS,
  buildChecklistGroups,
  dependencyWarnings,
  highPrivilegeWarnings,
  buildValidationReport,
};
