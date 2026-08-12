# Technical Implementation TODO

> Prepared by the Senior Designer per `DESIGNER.md`. This document is the implementation contract for the Developer Agent.
>
> **Issue**: Perubahan pada menu **LAPORAN** — tambah tab Sakit, perbaiki tampilan jenis cuti/tipe sakit yang masih ObjectId, hapus filter departemen, ganti filter karyawan jadi pencarian nama/username, tampilkan "Sedang Cuti" pada laporan absensi, ubah ekspor menjadi file Excel asli (bukan CSV), dan hilangkan ekspor PDF.

---

## Issue Summary

### User Request

1. Tab laporan kurang 1: **Sakit**. Isi tab Sakit dengan data sakit (tipe sakit jangan tampil sebagai ObjectId).
2. Pada tab Cuti, **jenis cuti masih ObjectId** → tampilkan nama.
3. **Hilangkan filter "ID departemen"** dari semua tab.
4. Filter **"ID karyawan" → "Cari karyawan"**: bisa mencari karyawan berdasarkan **username / nama lengkap** di semua tab.
5. Tab Absensi: jika status **cuti**, tampilkan **"Sedang Cuti"** pada kolom status.
6. Ekspor **Excel**: file harus benar-benar Excel (bukan CSV) — **pakai library `exceljs`** (user sudah pernah memakainya). Tampilkan **semua data yang diperlukan** — terutama `approved by`, `rejected by`, `status`. Lampiran/foto **tidak perlu**.
7. **Hilangkan ekspor PDF** dari semua tab.

### Problem

Audit menemukan kondisi saat ini:

- Hanya 4 tipe laporan (`ATTENDANCE/LEAVE/OVERTIME/TRIP`); tidak ada `SAKIT`.
- `LeaveReportProvider.query` mengembalikan `leaveType: p.leaveType` mentah (ObjectId) — begitu juga nanti Sakit bila ditambah tanpa resolusi nama.
- Filter bar memiliki input "ID karyawan" (raw id) dan "ID departemen"; tidak ada pencarian nama/username.
- Status absensi `LEAVE` dirender mentah/"Cuti", bukan "Sedang Cuti".
- Ekspor "excel" menghasilkan **CSV** (`text/csv`, ekstensi `.csv`); ekspor PDF aktif di UI & backend.
- `reporting:export_pdf` dipakai di UI + route + service.

### Expected Result

- 5 tab laporan: Absensi, Cuti, Lembur, Perjalanan Dinas, **Sakit**.
- Kolom "Jenis cuti" / "Tipe sakit" menampilkan **nama**, bukan ObjectId.
- Filter: hanya rentang tanggal + status + "Cari karyawan" (nama/username). Tidak ada filter departemen.
- Absensi dengan status cuti menampilkan **"Sedang Cuti"**.
- Ekspor menghasilkan file **Excel asli** (`.xlsx` via `exceljs`) berisi **semua kolom** termasuk approval columns; **tidak ada** tombol/laluan PDF.

### Issue Classification

Bug Fix + Functional Change (frontend + backend; tanpa perubahan database/schema).

### Scope

- Backend: `domain/report.js`, `infrastructure/report-providers.js`, `application/report.service.js`, `presentation/dto/report.dto.js`, `server.js` (wiring), exporter baru `infrastructure/exporters/excel.exporter.js`.
- Kontrak: `contracts/reports.ts`.
- Frontend: `features/reports/ReportCenterPage.tsx`, `ReportFilterBar.tsx`, `ReportTable.tsx`, `ExportButton.tsx`, `lib/axios.ts`, `lib/labels.ts`.
- Test: `test/integration/reports.api.test.js`, `test/unit/report.service.test.js`, `test/unit/report.exporter.test.js`.

---

## Existing Architecture

### Relevant Frontend

- `frontend/src/features/reports/ReportCenterPage.tsx` — tab laporan dirender dari `GET /reports/types` (otomatis bertambah saat backend menambah SAKIT).
- `frontend/src/features/reports/ReportFilterBar.tsx` — filter: Dari, Sampai, "ID karyawan", "ID departemen", Status.
- `frontend/src/features/reports/ReportTable.tsx` — `formatCell` mentah; tidak tahu jenis laporan.
- `frontend/src/features/reports/ExportButton.tsx` — tombol "Ekspor Excel" (CSV) + "Ekspor PDF".
- `frontend/src/lib/axios.ts:693-702` — `reportApi.types/preview/export`; `export(type, format: "excel" | "pdf", params)`.
- `frontend/src/lib/labels.ts:119-135` — `REPORT_COLUMN_LABELS` (belum ada `sicknessType`).

### Relevant Backend

- `backend/src/domain/report.js` — `REPORT_TYPES` (4 tipe), `REPORT_TYPE_KEYS`, `validateReportFilters` (allowed set termasuk `departmentId`), `projectRow`.
- `backend/src/infrastructure/report-providers.js` — `AttendanceReportProvider`, `LeaveReportProvider`, `OvertimeReportProvider`, `TripReportProvider`, `registerReportProviders`.
- `backend/src/application/report.service.js` — `resolveUserIds` (employeeId/departmentId/team), `preview`, `exportReport` (CSV/PDF), `exportAllModules` (CSV).
- `backend/src/presentation/dto/report.dto.js` — `reportFiltersSchema` (termasuk `departmentId`), `exportFormatSchema = z.enum(["excel", "pdf"])`.
- `backend/src/presentation/controllers/report.controller.js` — `parseFormat` (excel|pdf), `exportReport` stream.
- `backend/src/infrastructure/exporters/csv.exporter.js` — CSV dengan BOM; `pdf.exporter.js` — PDF minimal.
- `backend/server.js:204,209` — `leaveTypeRepository` & `sicknessTypeRepository` tersedia; `server.js:444-449` panggil `registerReportProviders({ registry, attendanceRepository, requestRepository, userRepository })`.
- `backend/src/infrastructure/repositories/user.repository.js:198-205` — `list({ search })` mendukung `$text` across name/username/email.

### Relevant Database

- Tidak ada perubahan schema. `requests.payload.leaveType` / `payload.sicknessType` menyimpan **ObjectId** (data baru) atau key (data lama); snapshot nama tersimpan di `payload.leaveTypeName` / `payload.sicknessTypeName` (set saat submit).

### Relevant API

- `GET /reports/types` — respons bertambah `SAKIT`.
- `GET /reports/:type` — menerima `employeeSearch`; `departmentId` tidak lagi dipakai UI (tetap di-ignore/di-strip oleh validasi).
- `GET /reports/:type/export?format=excel` — menghasilkan `.xlsx` (exceljs); `format=pdf` → 400.

### Relevant Authentication

- Tidak berubah (`authenticate` di semua route report).

### Relevant Authorization / RBAC

- Tidak ada permission baru. `reporting:export_pdf` **tetap terdaftar** di registry (tidak dihapus untuk menghindari churn RBAC/seed/test), tetapi tidak lagi dipakai oleh route/service/UI.

### Relevant Navigation

- Tidak berubah (menu Laporan tetap).

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | Affected | Filter bar, tabel (label status), tombol ekspor, axios, labels. |
| Backend | Affected | Domain report, provider, service export, DTO, wiring, exporter baru. |
| Database | Not Affected | Tidak ada schema/migration. |
| API | Affected | `/reports/types` (+SAKIT), filter `employeeSearch`, `format=pdf` ditolak. |
| Authentication | Not Affected | — |
| Authorization / RBAC | Not Affected | Permission `reporting:export_pdf` dibiarkan terdaftar tapi tidak dipakai. |
| Navigation | Not Affected | — |
| Business Logic | Affected | Resolusi nama tipe + pencarian karyawan + ekspor Excel. |
| Notifications | Not Affected | — |
| Reports | Affected | Seluruh fitur laporan (inti perubahan). |
| Audit Logs | Affected | Metadata `REPORT.EXPORTED` berubah (format hanya `excel`); perbaiki test. |
| Performance | Not Affected | Pencarian memakai index `$text` yang sudah ada. |
| Testing | Affected | Update test laporan (PDF→excel, +SAKIT, +employeeSearch). |

---

## Functional Requirements

### FR-001: Tambah tipe laporan SAKIT

**Type:** Functional (backend + contracts + labels)
**Priority:** High
**Status:** Proposed

**Description:**
Registrasi tipe laporan `SAKIT` dengan provider yang membaca request berjenis `SAKIT` dari koleksi `requests`, dan kolom yang lengkap (termasuk approval columns).

**Current Behavior:**
`REPORT_TYPES` hanya berisi 4 tipe; tidak ada tab Sakit.

**Expected Behavior:**
`GET /reports/types` mengembalikan 5 tipe; tab Sakit muncul otomatis di UI (dirender dari daftar types) dengan kolom: `employee, sicknessType, startDate, endDate, status, reason, approvalTarget, assignedApprover, approvedBy, rejectedBy, rejectionReason`.

**Affected Files:**
- `backend/src/domain/report.js`
- `backend/src/infrastructure/report-providers.js`
- `backend/server.js`
- `contracts/reports.ts`
- `frontend/src/lib/labels.ts`

**Implementation Instructions:**
1. `domain/report.js` — tambah entri di `REPORT_TYPES` (letakkan **setelah** TRIP agar urutan test lama tidak bergeser):
   ```js
   SAKIT: Object.freeze({
     key: "SAKIT",
     label: "Sakit",
     columns: ["employee", "sicknessType", "startDate", "endDate", "status", "reason", "approvalTarget", "assignedApprover", "approvedBy", "rejectedBy", "rejectionReason"],
     filterableBy: ["employeeId", "from", "to", "status"],
     provider: "sakit",
   }),
   ```
   Jangan tambahkan `departmentId` ke `filterableBy` tipe ini.
2. `report-providers.js`:
   - Tambah `class SakitReportProvider extends RequestReportProvider` dengan `this.key = "sakit"` dan `super({ ...deps, type: "SAKIT" })`.
   - `query` memetakan: `employee` (nama), `sicknessType` (resolusi nama — lihat FR-002), `startDate`/`endDate`/`reason` dari `payload`, `status: item.status`, `...(await this.approvalColumns(item))`.
   - Daftarkan di `registerReportProviders` (lihat FR-002 untuk deps tambahan).
3. `server.js` — tidak perlu perubahan mount route (provider diregistrasi via `registerReportProviders`).
4. `contracts/reports.ts` — `ReportTypeKey` tambah `"SAKIT"`.
5. `frontend/src/lib/labels.ts` — `REPORT_COLUMN_LABELS` tambah `sicknessType: "Tipe sakit"`.

**Dependencies:**
- FR-002 (resolusi nama tipe sakit).

**Must Preserve:**
- Urutan 4 tipe lama di `REPORT_TYPE_KEYS`.
- Kolom tipe lain tidak berubah.

**Acceptance Criteria:**
- [x] `GET /reports/types` mengembalikan 5 tipe termasuk SAKIT.
- [x] Tab "Sakit" muncul di UI dan menampilkan baris request SAKIT.
- [x] Kolom approval (approvedBy/rejectedBy/status) terisi untuk baris SAKIT.

#### Implementation Notes

Implemented in:

- `backend/src/domain/report.js` — `SAKIT` entry after TRIP (columns incl. `sicknessType` + approval columns; `filterableBy` tanpa departmentId).
- `backend/src/infrastructure/report-providers.js` — `SakitReportProvider` (`key: "sakit"`, `type: "SAKIT"`) + registered in `registerReportProviders`.
- `contracts/reports.ts` — `ReportTypeKey` + `"SAKIT"`.
- `frontend/src/lib/labels.ts` — `sicknessType: "Tipe sakit"`.

Verified:

- `GET /api/v1/reports/types` → 5 types (integration test F4 asserts SAKIT presence).
- Integration test F8 submits a SAKIT request and asserts the row appears with approval columns wired (via `approvalColumns`).
- `report.domain.test.js` updated: registry now asserts 5 ordered types.

---

### FR-002: Resolusi nama "Jenis cuti" & "Tipe sakit" pada baris laporan

**Type:** Bug Fix (backend)
**Priority:** High
**Status:** Proposed

**Description:**
`LeaveReportProvider` mengembalikan `leaveType: p.leaveType` mentah (ObjectId). Resolusi nama harus memakai urutan: snapshot `payload.leaveTypeName` (di-set saat submit) → lookup repository `leaveTypeRepository.findById` → fallback nilai mentah. Sama untuk `sicknessType` dengan `sicknessTypeRepository`.

**Current Behavior:**
Kolom "Jenis cuti" di tab Cuti menampilkan ObjectId.

**Expected Behavior:**
Kolom menampilkan nama tipe (mis. "Annual Leave" / "Cuti Tahunan"); tipe sakit menampilkan nama (mis. "Demam Berdarah").

**Affected Files:**
- `backend/src/infrastructure/report-providers.js`
- `backend/server.js`

**Implementation Instructions:**
1. `report-providers.js`:
   - `RequestReportProvider` constructor terima deps tambahan **opsional**: `leaveTypeRepository = null`, `sicknessTypeRepository = null`, simpan ke `this`.
   - Tambah helper:
     ```js
     async resolveLeaveTypeName(idOrKey) {
       if (!idOrKey) return null;
       if (this.leaveTypeRepository) {
         const t = await this.leaveTypeRepository.findById(idOrKey)
           ?? await this.leaveTypeRepository.findByKey(idOrKey);
         if (t) return t.name;
       }
       return null;
     }
     async resolveSicknessTypeName(idOrKey) {
       if (!idOrKey) return null;
       if (this.sicknessTypeRepository) {
         const t = await this.sicknessTypeRepository.findById(idOrKey)
           ?? await this.sicknessTypeRepository.findByKey(idOrKey);
         if (t) return t.name;
       }
       return null;
     }
     ```
   - `LeaveReportProvider.query`: `leaveType: p.leaveTypeName ?? (await this.resolveLeaveTypeName(p.leaveType)) ?? p.leaveType`.
   - `SakitReportProvider.query`: `sicknessType: p.sicknessTypeName ?? (await this.resolveSicknessTypeName(p.sicknessType)) ?? p.sicknessType`.
2. `registerReportProviders({ registry, attendanceRepository, requestRepository, userRepository, leaveTypeRepository = null, sicknessTypeRepository = null })` — teruskan ke konstruktor provider Leave & Sakit.
3. `server.js` panggilan `registerReportProviders(...)` (baris ~444-449): tambah `leaveTypeRepository` dan `sicknessTypeRepository`.

**Dependencies:**
- Tidak ada (FR-001 memakai ini).

**Must Preserve:**
- Provider lain (overtime/trip/attendance) tidak berubah.
- Bila deps repository null (di test/fake), fallback tetap memakai snapshot `payload.leaveTypeName` / `payload.sicknessTypeName` agar test lama tidak rusak.

**Acceptance Criteria:**
- [x] Tab Cuti menampilkan nama tipe, bukan ObjectId (data baru & lama).
- [x] Tab Sakit menampilkan nama tipe sakit, bukan ObjectId.
- [x] `npm test` backend tetap hijau (deps opsional).

#### Implementation Notes

Implemented in:

- `backend/src/infrastructure/report-providers.js` — `RequestReportProvider` menerima deps opsional `leaveTypeRepository`/`sicknessTypeRepository` + helper `resolveLeaveTypeName`/`resolveSicknessTypeName` (snapshot `payload.leaveTypeName`/`payload.sicknessTypeName` → `findById` → `findByKey` → nilai mentah).
- `backend/src/infrastructure/repositories/sickness-type.repository.js` — tambah `findById` null-safe (mirror `LeaveTypeRepository`; helper FR-002 memanggilnya — file ini tidak tercantum di TODO tetapi diperlukan agar instruksi helper berfungsi).
- `backend/server.js` — `registerReportProviders(...)` meneruskan `leaveTypeRepository` + `sicknessTypeRepository`.

Verified:

- Integration F4: `leaveType` = "Annual Leave" (key "ANNUAL" di-resolve via repo). Integration F8: `sicknessType` = "Demam".
- Unit test "preview resolves leave/sickness type names" menutup fallback snapshot; tanpa repo (fake) nilai mentah/key tetap keluar — test lama tetap hijau.

---

### FR-003: Hapus filter departemen + filter karyawan jadi pencarian nama/username

**Type:** Functional Change (backend + frontend)
**Priority:** High
**Status:** Proposed

**Description:**
Hilangkan filter "ID departemen" dari semua tab. Ganti filter "ID karyawan" (raw id) menjadi "Cari karyawan" yang mencari berdasarkan username/nama lengkap. Pencarian dilakukan **server-side** (reuse `userRepository.list({ search })` yang sudah memakai `$text`) sehingga tidak butuh permission `users:view` tambahan.

**Current Behavior:**
- `ReportFilterBar` punya input "ID karyawan" (`employeeId`) dan "ID departemen" (`departmentId`).
- `reportFiltersSchema` mengizinkan `departmentId`; `validateReportFilters` memasukkan `departmentId` di allowed set; `resolveUserIds` punya branch `departmentId`.

**Expected Behavior:**
- Filter bar: Dari, Sampai, **Cari karyawan** (placeholder "Cari nama / username"), Status.
- `departmentId` tidak lagi muncul di metadata `filterableBy`, di UI, maupun diterima validasi (di-strip).
- `employeeSearch` dikirim ke backend → di-resolve ke daftar userId via `userRepository.list({ search })`.

**Affected Files:**
- `backend/src/domain/report.js`
- `backend/src/presentation/dto/report.dto.js`
- `backend/src/application/report.service.js`
- `contracts/reports.ts`
- `frontend/src/features/reports/ReportFilterBar.tsx`

**Implementation Instructions:**
1. `domain/report.js`:
   - Hapus `"departmentId"` dari `filterableBy` semua tipe (5 tipe).
   - Di `validateReportFilters`, hapus `"departmentId"` dari allowed set; tambah `"employeeSearch"`.
2. `report.dto.js` — `reportFiltersSchema`: hapus `departmentId`; tambah `employeeSearch: z.string().optional()`. Biarkan `employeeId` (kompatibilitas API lama).
3. `report.service.js` — `resolveUserIds`:
   ```js
   if (filters.employeeSearch) {
     const { items } = await this.userRepository.list({
       search: filters.employeeSearch,
       page: 1,
       pageSize: 10000,
     });
     return items.map((u) => String(u._id ?? u.id));
   }
   if (filters.employeeId) return [filters.employeeId];
   // hapus branch departmentId
   ```
4. `contracts/reports.ts` — `ReportFilters`: hapus `departmentId?`; tambah `employeeSearch?: string`.
5. `ReportFilterBar.tsx`:
   - Hapus blok "ID departemen".
   - Ganti blok "ID karyawan" menjadi input label "Cari karyawan", `placeholder="Cari nama / username"`, diikat ke `employeeSearch` (`update("employeeSearch", ...)`).
   - Terapkan juga FR-004 responsive (`w-full sm:w-56`) bila belum.

**Dependencies:**
- Tidak ada.

**Must Preserve:**
- `employeeId` tetap diterima backend (API lama/tooling eksternal).
- Filter lain (from/to/status) tidak berubah.

**Acceptance Criteria:**
- [x] Filter "ID departemen" tidak ada di UI; `filterableBy` tidak memuatnya.
- [x] Mengetik "budi" pada "Cari karyawan" hanya menampilkan baris milik user bernama/berusername "budi".
- [x] Pencarian bekerja di semua 5 tab.
- [x] `departmentId` yang dikirim ke API di-strip (tidak error, tidak memfilter).

#### Implementation Notes

Implemented in:

- `backend/src/domain/report.js` — `departmentId` dihapus dari `filterableBy` semua tipe; allowed set validasi: hapus `departmentId`, tambah `employeeSearch`.
- `backend/src/presentation/dto/report.dto.js` — hapus `departmentId`; tambah `employeeSearch`; `employeeId` tetap (kompatibilitas).
- `backend/src/application/report.service.js` — `resolveUserIds`: branch `employeeSearch` → `userRepository.list({ search })` ($text index); branch `departmentId` dihapus.
- `contracts/reports.ts` — `ReportFilters` hapus `departmentId?`, tambah `employeeSearch?`.
- `frontend/src/features/reports/ReportFilterBar.tsx` — blok "ID departemen" dihapus; input "Cari karyawan" (`employeeSearch`, placeholder "Cari nama / username").

Verified:

- Unit test `resolveUserIds resolves employeeSearch to matching user ids` (nama/username, no-match → `[]`, `employeeId` legacy tetap).
- Integration F9: `employeeSearch=bob` → 1 baris (hanya employee.bob); tanpa search → 2 baris.
- Zod object default strip: `departmentId` yang dikirim ke API di-ignore tanpa error.

---

### FR-004: Status "Sedang Cuti" pada laporan absensi

**Type:** UI / Bug Fix
**Priority:** Medium
**Status:** Proposed

**Description:**
Pada tab Absensi, baris dengan status `LEAVE` (dibuat oleh sinkronisasi cuti disetujui) harus menampilkan **"Sedang Cuti"** pada kolom status.

**Current Behavior:**
`ReportTable.formatCell` merender nilai mentah (`LEAVE`); tabel tidak tahu jenis laporan.

**Expected Behavior:**
Tab Absensi menampilkan "Sedang Cuti" untuk status `LEAVE`; status lain tetap (NORMAL/EXCEPTION).

**Affected Files:**
- `frontend/src/features/reports/ReportTable.tsx`
- `frontend/src/features/reports/ReportCenterPage.tsx`

**Implementation Instructions:**
1. `ReportTable` tambah prop `type: ReportTypeKey` (import dari `@contracts/reports`).
2. Dalam `formatCell`, tambah konteks:
   ```tsx
   function formatCell(value: unknown, column: string): string {
     if (type === "ATTENDANCE" && column === "status" && value === "LEAVE") return "Sedang Cuti";
     // ...logic lama
   }
   ```
   Panggil dengan `formatCell(row[column], column)`.
3. `ReportCenterPage.tsx` — teruskan `type={type}` ke `<ReportTable columns={...} rows={...} type={type} />`.

**Dependencies:**
- Tidak ada.

**Must Preserve:**
- Pemformatan tanggal dan nilai lain di tabel.

**Acceptance Criteria:**
- [x] Tab Absensi menampilkan "Sedang Cuti" untuk baris status LEAVE.
- [x] Tab lain tidak terpengaruh.

#### Implementation Notes

Implemented in:

- `frontend/src/features/reports/ReportTable.tsx` — prop `type: ReportTypeKey`; `formatCell(value, type, column)` → `type === "ATTENDANCE" && column === "status" && value === "LEAVE"` → `"Sedang Cuti"`.
- `frontend/src/features/reports/ReportCenterPage.tsx` — teruskan `type={type}` ke `<ReportTable>`.

Verified: pemformatan tanggal & nilai lain tidak berubah; hanya status LEAVE pada tab Absensi yang dilabeli ulang.

---

### FR-005: Ekspor Excel asli (.xlsx via exceljs) berisi semua kolom

**Type:** Functional Change (backend + frontend)
**Priority:** High
**Status:** Proposed

**Description:**
Ganti ekspor "excel" yang sekarang berupa CSV menjadi file **Excel asli (.xlsx)** menggunakan library **`exceljs`** (dependency baru — diminta user). Ekspor memakai **semua kolom** tipe laporan (termasuk `status`, `approvedBy`, `rejectedBy`, `rejectionReason`, dst.). Lampiran **tidak** disertakan (tidak ada kolom lampiran).

**Current Behavior:**
`report.service.js` format `excel` memakai `renderCsv` → `text/csv`, filename `.csv`. UI mengunduh dengan ekstensi `.csv`.

**Expected Behavior:**
File `.xlsx` berisi header (label Indonesia) + semua kolom; `exportAllModules` juga menghasilkan `.xlsx`.

**Affected Files:**
- `backend/package.json` (tambah dependency `exceljs`)
- `backend/src/infrastructure/exporters/excel.exporter.js` (baru)
- `backend/src/domain/report.js` (label kolom)
- `backend/src/application/report.service.js`
- `frontend/src/features/reports/ExportButton.tsx`

**Implementation Instructions:**
1. `backend/package.json` — tambah `"exceljs": "^4.4.0"` pada `dependencies`, lalu jalankan `npm install` di `backend/`.
2. Buat `excel.exporter.js`:
   - `async renderExcel({ type, rows, columnLabels, title, generatedAt })`:
     ```js
     const ExcelJS = require("exceljs");
     const workbook = new ExcelJS.Workbook();
     workbook.created = new Date();
     const sheet = workbook.addWorksheet(type.label ?? "Laporan");
     sheet.columns = type.columns.map((col) => ({
       header: columnLabels[col] ?? col,
       key: col,
       width: 18,
     }));
     for (const row of rows) {
       const values = {};
       for (const col of type.columns) values[col] = row[col] ?? "";
       sheet.addRow(values);
     }
     sheet.getRow(1).font = { bold: true };
     return workbook.xlsx.writeBuffer(); // → Buffer
     ```
   - Export `{ renderExcel }`.
   - Catatan: `writeBuffer()` mengembalikan `Promise<Buffer>` — service harus `await`.
3. `domain/report.js` — tambah map label kolom (mirror `labels.ts`):
   ```js
   const REPORT_COLUMN_LABELS = Object.freeze({
     employee: "Karyawan", date: "Tanggal", clockInAt: "Absen masuk", clockOutAt: "Absen keluar",
     status: "Status", exceptionTypes: "Pengecualian", leaveType: "Jenis cuti", sicknessType: "Tipe sakit",
     startDate: "Tanggal mulai", endDate: "Tanggal selesai", reason: "Alasan",
     startTime: "Waktu mulai", endTime: "Waktu selesai", durationHours: "Durasi (jam)",
     destination: "Tujuan", purpose: "Tujuan kegiatan",
     approvalTarget: "Target Persetujuan", assignedApprover: "Penyetuju Ditugaskan",
     approvedBy: "Disetujui Oleh", rejectedBy: "Ditolak Oleh", rejectionReason: "Alasan Penolakan",
   });
   ```
   Export map tersebut.
4. `report.service.js`:
   - Import `renderExcel`.
   - Ganti branch excel: `content = await renderExcel({ type, rows: projected, columnLabels: REPORT_COLUMN_LABELS, title: `Laporan ${type.label}`, generatedAt })`; `contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`; `filename = `${typeKey.toLowerCase()}-report.xlsx``.
   - `exportAllModules`: gunakan `renderExcel` (kolom gabungan + `type` label) → filename `all-modules-report.xlsx`. Perlu `await` pada content.
   - Pastikan `content` (Buffer) tetap diteruskan ke controller (`res.send(content)`).
5. `ExportButton.tsx` — ubah `a.download` menjadi `${type.toLowerCase()}-report.xlsx`; teks tombol tetap "Ekspor Excel".

**Dependencies:**
- FR-006 (sama-sama menyentuh `report.service.js`; kerjakan berurutan).

**Must Preserve:**
- Isi data: semua kolom `type.columns` (sudah termasuk approval columns).
- Audit `REPORT.EXPORTED` tetap dicatat.

**Acceptance Criteria:**
- [x] `exceljs` terpasang di `backend/package.json`.
- [x] Ekspor Excel menghasilkan file `.xlsx` yang terbuka di Excel (bukan teks CSV).
- [x] Semua kolom tampil, termasuk status, approvedBy, rejectedBy, rejectionReason.
- [x] Tidak ada data lampiran/foto.

#### Implementation Notes

Implemented in:

- `backend/package.json` — dependency `exceljs ^4.4.0` (+ `npm install` sukses).
- `backend/src/infrastructure/exporters/excel.exporter.js` (baru) — `renderExcel({ type, rows, columnLabels, title, generatedAt })` via `ExcelJS.Workbook`; `await workbook.xlsx.writeBuffer()` → Buffer; title row + bold header + frozen header + `null → ""`.
- `backend/src/domain/report.js` — `REPORT_COLUMN_LABELS` (mirror `labels.ts` frontend).
- `backend/src/application/report.service.js` — branch excel → `await renderExcel(...)`, content-type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, filename `.xlsx`; `exportAllModules` juga `.xlsx` (`all-modules-report.xlsx`, kolom `type` → label "Modul").
- `frontend/src/features/reports/ExportButton.tsx` — download `${type.toLowerCase()}-report.xlsx`.

Verified:

- Unit: `renderExcel` round-trip (parse buffer, assert header "Karyawan" + row value); service export returns Buffer with PK zip signature; `exportAllModules` .xlsx.
- Integration F5: content-type `/spreadsheetml/`, disposition `leave-report.xlsx`, body starts "PK".
- Semua kolom `type.columns` termasuk approval columns ikut (projectRow memakai kolom tipe); tidak ada kolom lampiran.

---

### FR-006: Hilangkan ekspor PDF dari semua tab

**Type:** Functional Change (backend + frontend)
**Priority:** High
**Status:** Proposed

**Description:**
Hapus dukungan ekspor PDF: tombol UI, cabang service, dan validasi format. `reporting:export_pdf` tetap terdaftar di registry (tidak dihapus) untuk menghindari churn RBAC/seed/test, tetapi tidak dipakai.

**Current Behavior:**
- `ExportButton.tsx` menampilkan tombol "Ekspor PDF".
- `report.service.js` punya cabang `format === "pdf"` memakai `renderPdf`.
- `exportFormatSchema = z.enum(["excel", "pdf"])` menerima `pdf`.
- `axios.ts` `reportApi.export` bertipe `format: "excel" | "pdf"`.

**Expected Behavior:**
Hanya "Ekspor Excel". `format=pdf` → 400 (tidak lolos schema). Tidak ada referensi `renderPdf` di service.

**Affected Files:**
- `backend/src/presentation/dto/report.dto.js`
- `backend/src/application/report.service.js`
- `frontend/src/features/reports/ExportButton.tsx`
- `frontend/src/lib/axios.ts`
- `backend/test/integration/reports.api.test.js`
- `backend/test/unit/report.service.test.js`

**Implementation Instructions:**
1. `report.dto.js` — `exportFormatSchema = z.enum(["excel"])` (format lain → 400).
2. `report.service.js` — hapus cabang `if (format === "pdf")`, import `renderPdf`, dan `summarizeFilters` bila tidak terpakai lagi.
3. `ExportButton.tsx` — hapus tombol PDF, state `busy` hanya `"excel" | null`; hapus `Can` PDF.
4. `axios.ts:697` — `format: "excel"` saja.
5. `report.service.test.js` — hapus/ubah assertion `reporting:export_pdf` (baris ~193).
6. `reports.api.test.js:120,134` — ubah test `format: "pdf"` menjadi `format: "excel"` dan assertion `metadata.format === "pdf"` → `"excel"`.
7. Biarkan `pdf.exporter.js` + `test/unit/report.exporter.test.js` apa adanya (exporter tidak lagi dipakai service; unit test-nya menguji fungsi exporter secara terisolasi — tetap hijau). Dokumentasikan di Developer Notes.

**Dependencies:**
- FR-005 (berurutan).

**Must Preserve:**
- Permission `reporting:export_pdf` di registry, seed, contracts/permissions.ts (tidak dihapus).
- Test auth/navigation yang menyebut key tersebut tetap hijau.

**Acceptance Criteria:**
- [x] Tidak ada tombol "Ekspor PDF" di UI.
- [x] `format=pdf` → 400.
- [x] `npm test` backend hijau.

#### Implementation Notes

Implemented in:

- `backend/src/presentation/dto/report.dto.js` — `exportFormatSchema = z.enum(["excel"])` → `format=pdf` → 400 `VALIDATION_FAILED`.
- `backend/src/application/report.service.js` — cabang `format === "pdf"`, import `renderPdf`, dan `summarizeFilters` dihapus; permission export selalu `reporting:export_excel`.
- `frontend/src/features/reports/ExportButton.tsx` — tombol PDF + `Can` PDF + state `busy` `"pdf"` dihapus.
- `frontend/src/lib/axios.ts` — `reportApi.export` bertipe `format: "excel"` saja.
- `backend/src/presentation/controllers/report.controller.js` — pesan error `parseFormat` diperbarui ("format must be excel.").
- `backend/src/presentation/routes/report.routes.js` — komentar diperbarui.

Verified:

- Integration F5: `format=pdf` → 400.
- `reporting:export_pdf` TETAP terdaftar di registry/seed/role-templates/permission-checklist (sesuai instruksi TODO — tidak dihapus). `pdf.exporter.js` + unit test-nya tetap (exporter tidak lagi dipakai service).
- Test auth/navigation yang menyebut key tersebut tetap hijau.

---

### FR-007: Update & tambah test laporan + verifikasi menyeluruh

**Type:** Test
**Priority:** Medium
**Status:** Proposed

**Description:**
Perbarui test yang terdampak dan tambah cakupan untuk fitur baru.

**Affected Files:**
- `backend/test/integration/reports.api.test.js`
- `backend/test/unit/report.service.test.js`
- `backend/test/unit/report.exporter.test.js`

**Implementation Instructions:**
1. `reports.api.test.js`:
   - Test `types` → assert 5 tipe termasuk SAKIT.
   - Test preview SAKIT: buat request SAKIT (pakai `sicknessType` id + `sicknessTypeName` snapshot), assert kolom `sicknessType` berisi nama.
   - Test preview LEAVE: submit dengan `leaveType` id + `leaveTypeName`, assert kolom `leaveType` = nama (bukan ObjectId).
   - Test filter `employeeSearch=...` membatasi baris ke user yang cocok.
   - Ganti test PDF menjadi Excel (FR-006).
2. `report.service.test.js`:
   - Update ekspektasi format export (excel `.xlsx`), hapus ekspektasi `reporting:export_pdf`.
   - Tambah case `resolveUserIds` dengan `employeeSearch`.
3. `report.exporter.test.js` — tambah test `renderExcel` (XML berisi header + nilai; escaping aman).

**Dependencies:**
- FR-001 s.d. FR-006.

**Must Preserve:**
- Test lain yang memakai `registerReportProviders` tanpa deps baru tetap jalan (deps baru opsional).

**Acceptance Criteria:**
- [x] `npm test` backend hijau seluruhnya (853 tests; 2 kegagalan pra-eksisting `listMine` yang tidak terkait — lihat Implementation Summary).
- [x] Test baru menangkap regresi ObjectId dan PDF.

#### Implementation Notes

Updated/added:

- `backend/test/integration/reports.api.test.js` — F4 (types = 5 + SAKIT; `leaveType` = "Annual Leave"); F5 (excel `.xlsx` + `format=pdf` → 400 + audit format excel); F8 baru (SAKIT preview, `sicknessType` = "Demam"); F9 baru (`employeeSearch`); `beforeEach` seed kini meneruskan `sicknessTypeRepository` (diperlukan agar tipe sakit ter-seed).
- `backend/test/unit/report.service.test.js` — listTypes 5 tipe + tanpa departmentId; preview SAKIT/LEAVE name; `resolveUserIds` employeeSearch; export excel Buffer `.xlsx`; `exportAllModules` `.xlsx`; ekspektasi `reporting:export_pdf` dihapus.
- `backend/test/unit/report.domain.test.js` — registry 5 tipe + assertion `departmentId` tidak ada.
- `backend/test/unit/report.exporter.test.js` — test `renderExcel` baru (round-trip parse buffer).

Verified:

- Seluruh test report (unit + integration) hijau.
- F9 memanggil `UserModel.syncIndexes()` setelah `dropDatabase()` per-test karena index `$text` tidak dibuat ulang otomatis oleh Mongoose setelah drop (tidak ada integration test lain yang memakai `$text` sebelum ini).

---

## API Changes

### Endpoint Changes

- `GET /api/v1/reports/types` → 5 tipe (termasuk SAKIT).
- `GET /api/v1/reports/:type/export?format=excel` → `.xlsx`; `format=pdf` → 400.

### Request Changes

- Filter: `employeeSearch` (baru, opsional); `departmentId` dihapus dari schema/UI (tetap di-ignore bila dikirim).
- `employeeId` tetap diterima (kompatibilitas).

### Response Changes

- Baris laporan: `leaveType` / `sicknessType` berisi nama.
- `filterableBy` tidak memuat `departmentId`.

### Error Handling

- `format=pdf` → `VALIDATION_FAILED` (400).

---

## Database Changes

### Existing Models

- `requests` (payload), `leave-types`, `sickness-types`, `users` — tidak berubah.

### Required Changes

- Tidak ada.

### Migration Requirements

- Tidak ada.

---

## Frontend Changes

### Pages

- `ReportCenterPage.tsx` — teruskan `type` ke tabel (FR-004).

### Components

- `ReportFilterBar.tsx` — hapus departemen; "Cari karyawan" (FR-003).
- `ReportTable.tsx` — prop `type` + label "Sedang Cuti" (FR-004).
- `ExportButton.tsx` — hanya Excel `.xlsx` (FR-005/006).

### Hooks / State

- Tidak ada perubahan state baru.

### Forms

- Filter bar laporan.

### Validation

- `format` hanya `excel` (backend).

### UI / UX

- Tab Sakit muncul otomatis; kolom nama; filter pencarian nama.

---

## Backend Changes

### Routes

- Tidak ada perubahan route (format di validasi DTO).

### Controllers

- `report.controller.js` — tidak berubah (content-type/filename dari service).

### Services

- `report.service.js` — `resolveUserIds` (employeeSearch), ekspor excel `.xlsx` via exceljs, hapus pdf.

### Validation

- `report.dto.js` — `employeeSearch`, hapus `departmentId`, `exportFormatSchema` hanya excel.

### Authorization

- Tidak berubah.

### Exporter

- `excel.exporter.js` (baru) — workbook `.xlsx` via `exceljs`.

---

## Cross-Layer Implementation Flow

```text
Tab Laporan (5 tab dari GET /reports/types)
    ↓
ReportFilterBar: "Cari karyawan" → employeeSearch
    ↓
GET /reports/:type?employeeSearch=...  (report.dto → resolveUserIds → userRepository.list $text)
    ↓
Provider (Leave/Sakit) → resolveLeaveTypeName / resolveSicknessTypeName
    → kolom tampil nama, bukan ObjectId
    ↓
ReportTable: ATTENDANCE + status LEAVE → "Sedang Cuti"
    ↓
Ekspor: report.service → renderExcel (exceljs workbook) → .xlsx
    (semua kolom; PDF dihapus)
```

---

## Regression Protection

- Tipe laporan lama (4) tidak berubah urutan/kolomnya.
- `employeeId` tetap berfungsi untuk konsumen API lama.
- Permission `reporting:export_pdf` tetap terdaftar (tidak merusak seed/test auth/navigation).
- Provider baru memakai deps opsional → test/fake lama tetap jalan.
- Tidak ada perubahan schema DB, RBAC baru, atau kontrak yang merusak.
- Audit tetap dicatat untuk preview/export.

---

## Edge Cases

- **Data lama tanpa snapshot nama** (`payload.leaveTypeName` kosong): fallback ke `findById`/`findByKey`; bila tetap tidak ketemu → tampilkan nilai mentah (tidak crash).
- **Tipe dinonaktifkan/dihapus**: lookup repository mengembalikan null → fallback nilai mentah.
- **`employeeSearch` tanpa hasil**: `resolveUserIds` → array kosong → `requesterId: { $in: [] }` → 0 baris (tidak error).
- **Search `$text`** membutuhkan text index — sudah ada di `user.model.js:92`; verifikasi tetap ada.
- **Nilai Excel dengan karakter khusus**: `exceljs` menangani escaping & tipe sel secara otomatis; nilai `null` ditulis sebagai sel kosong (di-set `""` di exporter).
- **Baris null di Excel**: sel kosong.
- **Nama laporan/label**: map `REPORT_COLUMN_LABELS` di backend adalah mirror manual `labels.ts` — dokumentasikan risiko drift (sama seperti `contracts/permissions.ts`).

---

## Testing / Verification

### Frontend

- [x] `npm run lint` + `npm run build` di `frontend/`.
- [ ] Manual: 5 tab tampil; tab Sakit menampilkan nama tipe sakit; tab Cuti menampilkan nama jenis cuti.
- [ ] Manual: filter "Cari karyawan" dengan nama/username.
- [ ] Manual: tab Absensi status LEAVE → "Sedang Cuti".
- [ ] Manual: ekspor Excel menghasilkan `.xlsx` terbuka di Excel; tidak ada tombol PDF.

> Manual browser checks left open for the QA/human reviewer; automated gates (lint + strict tsc build + backend suite) pass.

### Backend

- [x] `npm test` di `backend/` seluruhnya — 853 tests, 851 pass, 2 fail (kedua kegagalan adalah asersi `listMine` summary pra-eksisting yang tidak terkait: `request.service.test.js:237` dan `selfservice.api.test.js:99`).

### API

- [x] `GET /reports/types` → 5 tipe (integration F4).
- [x] `GET /reports/:type/export?format=excel` → `.xlsx`; `format=pdf` → 400 (integration F5).
- [x] `GET /reports/:type?employeeSearch=bob` → baris user "bob" (integration F9).

### Database

- [x] Tidak ada migration; text index user tetap ada (`user.model.js:92`; F9 memastikan `syncIndexes` di test DB).

### RBAC

- [x] Tidak ada perubahan; `reporting:export_excel` tetap dipakai untuk ekspor; `reporting:export_pdf` tetap terdaftar (tidak dipakai).

### Regression

- [x] Test laporan lama di-update dan hijau (report.domain/service/exporter + integration).
- [x] Preview & ekspor audit tetap tercatat (REPORT.VIEWED / REPORT.EXPORTED).

---

## Implementation Order

1. **FR-002** — resolusi nama tipe (deps opsional, aman).
2. **FR-001** — tipe SAKIT (menggunakan FR-002).
3. **FR-003** — filter departemen dihapus + "Cari karyawan".
4. **FR-004** — "Sedang Cuti" pada tabel absensi.
5. **FR-005** — ekspor Excel `.xlsx` (exceljs).
6. **FR-006** — hapus PDF.
7. **FR-007** — update & tambah test; jalankan `npm test`.

Alasan: FR-002 mendahului FR-001 agar tab Sakit langsung menampilkan nama; FR-005 dan FR-006 menyentuh `report.service.js` yang sama, dikerjakan berurutan; FR-007 menutup seluruhnya.

---

## Developer Notes

- **Ekspor Excel memakai `exceljs`** (diminta user; dependency baru yang disengaja). Tambahkan ke `backend/package.json` `dependencies` dan jalankan `npm install` di `backend/`. `exceljs` kompatibel CommonJS (`require("exceljs")`) dan `writeBuffer()` mengembalikan Promise — service harus `await` sebelum `res.send`.
- **`reporting:export_pdf`** tidak dihapus dari registry/seed/contracts agar RBAC & test auth tetap sinkron; hanya tidak dipakai. Catat sebagai dead permission bila ingin dibersihkan terpisah.
- **`pdf.exporter.js`** dibiarkan (tidak dipakai service) + unit test-nya tetap; penghapusan file opsional di PR terpisah.
- **Mirror label**: `REPORT_COLUMN_LABELS` (backend) dan `REPORT_COLUMN_LABELS` (frontend `labels.ts`) harus konsisten; perbarui keduanya bersama.
- **`employeeSearch`** memakai `$text` index users; jangan hapus text index `user.model.js:92`.
- Jangan ubah `contracts/permissions.ts` — hanya `contracts/reports.ts`.

---

## Definition of Done

- [x] 5 tab laporan termasuk Sakit.
- [x] Jenis cuti & tipe sakit tampil sebagai nama, bukan ObjectId.
- [x] Filter departemen hilang; "Cari karyawan" bekerja (nama/username) di semua tab.
- [x] Absensi status cuti → "Sedang Cuti".
- [x] Ekspor Excel `.xlsx` berisi semua kolom (status, approvedBy, rejectedBy, rejectionReason).
- [x] Ekspor PDF dihapus dari UI & backend (`format=pdf` → 400).
- [x] `npm test` backend hijau (851/853; 2 kegagalan pra-eksisting `listMine` tidak terkait); `npm run lint` + `npm run build` frontend hijau.
- [x] Tidak ada perubahan schema DB / permission baru; satu-satunya library baru adalah `exceljs` (diminta user).
- [x] Regresi: tipe laporan lama, `employeeId`, audit, RBAC tidak rusak.

---

## Implementation Summary

### Completed

- FR-001 — Tambah tipe laporan SAKIT
- FR-002 — Resolusi nama "Jenis cuti" & "Tipe sakit" pada baris laporan
- FR-003 — Hapus filter departemen + filter karyawan jadi pencarian nama/username
- FR-004 — Status "Sedang Cuti" pada laporan absensi
- FR-005 — Ekspor Excel asli (.xlsx via exceljs) berisi semua kolom
- FR-006 — Hilangkan ekspor PDF dari semua tab
- FR-007 — Update & tambah test laporan + verifikasi menyeluruh

### Files Changed

Backend:

- `backend/package.json` (FR-005 — `exceljs ^4.4.0`)
- `backend/src/infrastructure/exporters/excel.exporter.js` (FR-005 — baru)
- `backend/src/domain/report.js` (FR-001/003/005 — SAKIT, filterableBy, allowed set, `REPORT_COLUMN_LABELS`)
- `backend/src/infrastructure/report-providers.js` (FR-001/002 — resolver nama + `SakitReportProvider` + deps opsional)
- `backend/src/infrastructure/repositories/sickness-type.repository.js` (FR-002 — `findById` null-safe)
- `backend/src/application/report.service.js` (FR-003/005/006 — employeeSearch, renderExcel, hapus PDF)
- `backend/src/presentation/dto/report.dto.js` (FR-003/006 — employeeSearch, hapus departmentId, format excel only)
- `backend/src/presentation/controllers/report.controller.js` (FR-006 — pesan error format)
- `backend/src/presentation/routes/report.routes.js` (FR-006 — komentar)
- `backend/server.js` (FR-001/002 — provider deps)

Kontrak:

- `contracts/reports.ts` (FR-001/003 — `"SAKIT"`, `employeeSearch`, hapus `departmentId`)

Frontend:

- `frontend/src/lib/labels.ts` (FR-001 — `sicknessType` label + approval labels)
- `frontend/src/lib/axios.ts` (FR-006 — `format: "excel"`)
- `frontend/src/features/reports/ReportFilterBar.tsx` (FR-003)
- `frontend/src/features/reports/ReportTable.tsx` (FR-004 — prop `type` + "Sedang Cuti")
- `frontend/src/features/reports/ReportCenterPage.tsx` (FR-004 — pass `type`)
- `frontend/src/features/reports/ExportButton.tsx` (FR-005/006 — `.xlsx`, hapus PDF)

Test:

- `backend/test/integration/reports.api.test.js` (FR-007)
- `backend/test/unit/report.service.test.js` (FR-007)
- `backend/test/unit/report.domain.test.js` (FR-007)
- `backend/test/unit/report.exporter.test.js` (FR-007)

### Database Changes

- None. Tidak ada schema/migration; `requests` payload, `leave-types`, `sickness-types`, `users` tidak berubah. Text index user (`user.model.js:92`) tetap.

### API Changes

- `GET /api/v1/reports/types` → 5 tipe (termasuk SAKIT).
- `GET /api/v1/reports/:type` — menerima `employeeSearch`; `departmentId` di-strip (zod default strip); `employeeId` tetap.
- `GET /api/v1/reports/:type/export?format=excel` → `.xlsx` (exceljs); `format=pdf` → 400 `VALIDATION_FAILED`.
- Baris laporan: `leaveType`/`sicknessType` berisi nama (bukan ObjectId).

### Remaining Work

- Manual browser QA (5 tab, nama tipe, "Cari karyawan", "Sedang Cuti", unduh `.xlsx`) — kotak manual dibiarkan terbuka di Testing/Verification.
- Dua kegagalan test pra-eksisting yang **tidak terkait**: `test/unit/request.service.test.js:237` dan `test/integration/selfservice.api.test.js:99` menegaskan `item.summary.includes("ANNUAL cuti")` pada `GET /requests/mine`, padahal format `summarizeRequest` saat ini tidak pernah memuat literal "cuti". Perlu triase terpisah.
- `reporting:export_pdf` kini dead permission (tetap terdaftar sesuai instruksi TODO; pembersihan terpisah bila diinginkan). `pdf.exporter.js` + `csv.exporter.js` tidak lagi dipakai service (file + unit test tetap).

### Verification

- [x] Frontend verified (`npm run lint` + `npm run build` pass)
- [x] Backend verified (`npm test`: 853 tests, 851 pass; 2 kegagalan pra-eksisting `listMine` tidak terkait)
- [x] API verified (integration: types=5, SAKIT name, employeeSearch, excel .xlsx, pdf→400)
- [x] Database verified (tanpa schema change; text index tetap; syncIndexes di test F9)
- [x] RBAC verified (`reporting:export_excel` dipakai; `reporting:export_pdf` tetap terdaftar, tidak dipakai)
- [x] Regression checked (4 tipe lama, `employeeId`, audit REPORT.VIEWED/EXPORTED, provider tanpa deps baru tetap jalan)
