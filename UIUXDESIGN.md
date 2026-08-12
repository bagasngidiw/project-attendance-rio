Read the current project structure and existing sidebar/menu implementation first.

TASK: Revamp the HRIS sidebar navigation by grouping the existing menu items into logical sections.

IMPORTANT:
- DO NOT create a new sidebar from scratch if an existing reusable sidebar/menu component already exists.
- Reuse the existing sidebar architecture, components, icons, routing, RBAC/permission logic, collapsed/expanded behavior, and styling system.
- DO NOT remove any existing feature, route, permission, or functionality.
- DO NOT change the existing RBAC behavior.
- Only reorganize the navigation structure and presentation.
- Make sure every existing route remains accessible after the refactor.
- Do not introduce duplicate menu items or duplicate routes.
- Do not hardcode role-specific visibility if the project already has a permission/RBAC system.
- Preserve the current responsive behavior.
- Preserve sidebar collapse/expand behavior.
- Follow the project's existing React + Vite + TypeScript architecture and conventions.
- Before modifying anything, inspect the existing sidebar/menu implementation and understand how menu permissions and routes are currently resolved.
- After the change, verify that there are no broken imports, invalid routes, duplicate keys, TypeScript errors, or missing menu items.

TARGET SIDEBAR STRUCTURE:

INFORMASI
├── Dashboard
├── Permintaan Saya
└── Notifikasi

KARYAWAN
├── Absensi
├── Lembur
├── Perjalanan Dinas
├── Cuti
├── Ijin
└── Sakit

MANAJEMEN
├── Tim Saya
├── Pengguna
└── Organisasi

PERSETUJUAN
├── Persetujuan
├── Kotak Masuk Persetujuan
└── Riwayat Persetujuan

LAPORAN
└── Laporan

ADMINISTRASI
├── Peran & Izin
├── Konfigurasi Persetujuan
└── Master Data

SISTEM
├── Platform Settings
├── Log Aktivitas
├── Log Audit
└── Profil

EXPECTED BEHAVIOR:

1. INFORMASI
   - Dashboard
   - Permintaan Saya
   - Notifikasi

2. KARYAWAN
   - Absensi
   - Lembur
   - Perjalanan Dinas
   - Cuti
   - Ijin
   - Sakit

3. MANAJEMEN
   - Tim Saya
   - Pengguna
   - Organisasi

4. PERSETUJUAN
   - Persetujuan
   - Kotak Masuk Persetujuan
   - Riwayat Persetujuan

5. LAPORAN
   - Laporan

6. ADMINISTRASI
   - Peran & Izin
   - Konfigurasi Persetujuan
   - Master Data

7. SISTEM
   - Platform Settings
   - Log Aktivitas
   - Log Audit
   - Profil

RBAC REQUIREMENT:

The grouping above is only the navigation organization.

Menu visibility MUST continue to be controlled by the existing RBAC/permission system.

For example:
- Employee should only see the menus permitted to their role.
- Manager/approver should see approval-related menus if their permissions allow them.
- Admin should see administrative menus according to their permissions.
- Super Admin can see all permitted modules.

Do NOT assume that every user can see every group.

A group should automatically disappear when none of its child menu items are visible to the current user.

If a group contains at least one permitted menu item, display the group and only display the permitted children.

UI REQUIREMENTS:

- Section/group labels should be visually subtle and clearly separated from menu items.
- Menu items should retain the existing icons where possible.
- Active route styling must continue to work correctly.
- Hover/focus/active states must remain consistent with the existing design system.
- Collapsed sidebar behavior must remain functional.
- When the sidebar is collapsed, section labels should not break the layout.
- Avoid unnecessary visual redesign; this task is primarily navigation information architecture and organization.
- Keep the sidebar clean and suitable for an enterprise HRIS SaaS product.

IMPLEMENTATION SAFETY:

Before finishing:
- Check every existing sidebar route against the new structure.
- Confirm no route was accidentally removed.
- Confirm no existing permission was bypassed.
- Confirm no duplicate route exists.
- Confirm no duplicate React keys exist.
- Confirm all imported icons/components exist.
- Confirm TypeScript compilation has no errors.
- Confirm the application can still navigate to every existing menu.
- Confirm direct URL navigation still works.
- Confirm the sidebar works for different RBAC roles.
- Confirm empty groups are hidden.
- Confirm collapsed and expanded sidebar states still work.

Do not modify unrelated features.

The final result should be a clean, reusable, RBAC-aware grouped sidebar suitable for a production-grade HRIS SaaS application.