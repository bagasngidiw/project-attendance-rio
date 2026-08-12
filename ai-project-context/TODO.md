# Technical Implementation TODO

> Prepared by the Senior Designer per `DESIGNER.md`. This document is the implementation contract for the Developer Agent.
>
> **Issue**: User request (from `.opencode/prompts/DESIGNER.md` §USER REQUEST FORMAT):
> *"Baca `ai-project-context/NEW UPDATE TAD SIMBIKA.xlsx`. Aplikasi sudah live; tidak ingin menambahkan fitur besar, tapi karena klien butuh data seperti di Excel (NIP, JABATAN, PENEMPATAN, NAMA KONTRAK), tambahkan 2 master data baru — KONTRAK dan PENEMPATAN (string, di menu Master Data bersama Tipe Cuti/Tipe Sakit, bisa dinonaktifkan). Di menu Pengguna: hapus form departemen+jabatan dan kolom departemen/jabatan/manajer di list; tambahkan pilihan Kontrak+Penempatan (dari database, disimpan sebagai ObjectId yang di-populate) dan field NIP (string) di form baru/edit; tambahkan aksi Lihat (komponen sama dengan Edit, tanpa tombol Simpan, menampilkan NIP/Kontrak/Penempatan). End-to-end backend→frontend→UI, testing aman, akan dipresentasikan hari ini."*

---

## Issue Summary

### User Request

1. **Master Data baru: KONTRAK + PENEMPATAN** — string data, di menu Master Data (sama seperti Tipe Cuti / Tipe Sakit), mendukung nonaktifkan (ACTIVE/INACTIVE).
2. **Menu Pengguna (list)**: hapus kolom **Departemen, Jabatan, Manajer**.
3. **Form Pengguna Baru**: hapus field Departemen + Jabatan; tambah pilihan **Kontrak + Penempatan** (data dari database, **ObjectId**, di-populate) dan field **NIP** (string).
4. **Form Edit Pengguna**: tambah pilihan Kontrak + Penempatan dan field NIP.
5. **Aksi "Lihat"** di list pengguna: komponen yang sama dengan Edit, **tanpa tombol Simpan**, menampilkan hal yang sama dengan Detail (termasuk NIP, Kontrak, Penempatan).
6. End-to-end, tested, **dipresentasikan hari ini**.

### Verified Facts (from the Excel)

`NEW UPDATE TAD SIMBIKA.xlsx` → sheet `PEGAWAI`, 74 baris: `NAMA KONTRAK` (4 nilai), `NIP` (unik, alfanumerik, contoh `742100590SIM`), `NAMA PEGAWAI`, `JABATAN` (semua `PENGEMUDI`), `PENEMPATAN` (10 nilai). Data inilah yang nantinya diisi ke master data + user, tapi **import massal Excel ke user TIDAK termasuk scope request ini** (hanya master data + form user + aksi Lihat).

### Verified Facts (from the codebase)

**Pola master data (Tipe Sakit — dipakai sebagai acuan):**
- `backend/src/infrastructure/models/sickness-type.model.js` — `key` (unique uppercase), `name`, `description`, `status` (ACTIVE/INACTIVE/PENDING), `isSystem`, `suggestedBy`, `updatedBy`, timestamps.
- `backend/src/domain/sickness-type.js` — enum status + `validateSicknessTypeInput` + `isActiveSicknessType`.
- `backend/src/infrastructure/repositories/sickness-type.repository.js` — findByKey/findById/getById/create/update/setStatus/list/listActive.
- `backend/src/application/sickness-type.service.js` — listActive/list/create/update/activate/deactivate/isActiveType/findById/toDto.
- `backend/src/presentation/routes/sakit.routes.js` — `createSicknessTypeRoutes` (GET / aktif + POST /suggest) + `createSicknessTypeAdminRoutes` (GET /, POST /, PUT /:id, POST /:id/activate, POST /:id/deactivate; semua `platform:settings`).
- Mount: `server.js:614-615` → `/api/v1/sickness-types` + `/api/v1/admin/sickness-types`.
- Frontend: `sicknessTypeApi` + `sicknessTypeAdminApi` di `frontend/src/lib/axios.ts`; `MasterDataPage.tsx` (tab Tipe Cuti/Tipe Sakit) → `MasterDataPanel.tsx` (panel reusable: buat + aktif/nonaktif).

**Fitur Pengguna:**
- `backend/src/infrastructure/models/user.model.js` — **tidak ada** `nip` / `contractTypeId` / `placementId`; punya `departmentId`/`positionId`/`managerId` (DIPERTAHANKAN di model/API — hanya dihapus dari form/kolom UI).
- `backend/src/presentation/dto/user.dto.js` — `createUserDto` + `updateUserDto` (perlu ditambah `nip`, `contractTypeId`, `placementId`).
- `backend/src/application/user-admin.service.js` — `createUser` (validasi org refs via `assertActiveOrgRefs`), `updateUser` (before/after audit), `listUsers`, `getUser`, `toUserDto`, `enrichRoleKeys` + `loadRelationNames` (batch resolve departmentName/positionName/managerName — pola untuk populate nama kontrak/penempatan).
- `backend/src/presentation/controllers/user.controller.js` + `backend/src/presentation/routes/user.routes.js` — controller/routes yang sudah ada; hanya DTO + service yang berubah.
- Frontend: `features/users/UsersPage.tsx` (kolom Nama/Nama pengguna/Email/**Departemen**/**Jabatan**/**Manajer**/Status/Peran/Aksi; aksi Edit/Nonaktifkan/Reset/Aktifkan), `CreateUserDialog.tsx` (punya DepartmentSelect/PositionSelect dari `features/org/OrgPicker.tsx`), `EditUserDialog.tsx` (name/email + jatah cuti + jadwal; **tidak ada** departemen/jabatan), `features/users/types.ts` (`UserListItem`).
- `features/org/OrgPicker.tsx` — pola `<select>` untuk pilihan aktif (acuan untuk ContractSelect/PlacementSelect baru).

### Problem

- Master data KONTRAK/PENEMPATAN belum ada (model/service/route/UI).
- User tidak punya field `nip`, `contractTypeId`, `placementId`; DTO/service tidak menerimanya; DTO tidak meng-populate nama.
- UI user masih menampilkan Departemen/Jabatan/Manajer dan belum ada Kontrak/Penempatan/NIP, belum ada aksi Lihat.

### Expected Result

- Master data KONTRAK + PENEMPATAN lengkap (backend + UI tab Master Data), bisa dibuat/dinonaktifkan/aktifkan ulang, diaudit.
- Form Pengguna Baru: tanpa Departemen/Jabatan; dengan NIP (string) + pilihan Kontrak/Penempatan (aktif, dari DB).
- Form Edit Pengguna: NIP + Kontrak/Penempatan (terisi nilai saat ini).
- List Pengguna: tanpa kolom Departemen/Jabatan/Manajer; ada aksi **Lihat** (read-only, komponen sama dengan Edit, tanpa Simpan).
- Backend menyimpan `nip` (string), `contractTypeId`/`placementId` (ObjectId), dan DTO mengembalikan `contractName`/`placementName` (populate/relation-name).
- Tidak ada regresi: org/reporting/team tetap jalan; user lama tidak terdampak.

### Issue Classification

New Feature (master data + penyesuaian user admin) — full-stack, end-to-end.

### Scope

- **Backend baru**: master data KONTRAK (`contract_type` collection) + PENEMPATAN (`placement` collection): model, domain, repository, service, controller, DTO, routes, wiring `server.js`.
- **Backend ubah**: `user.model.js` (+`nip`, +`contractTypeId`, +`placementId`), `user.dto.js`, `user-admin.service.js` (validasi active ref, persist, audit, toUserDto + nama), (opsional) `user.controller.js` hanya jika perlu.
- **Frontend baru**: `features/admin/MasterSelects.tsx` (ContractTypeSelect/PlacementSelect), API clients baru di `axios.ts`, tab Master Data, `UserViewDialog` (atau prop readOnly di EditUserDialog).
- **Frontend ubah**: `MasterDataPage.tsx`, `UsersPage.tsx`, `CreateUserDialog.tsx`, `EditUserDialog.tsx`, `QuotaAndScheduleSection.tsx` (prop `disabled`), `features/users/types.ts`, `contracts/*` types.
- **TIDAK diubah**: `departmentId`/`positionId`/`managerId` di model & API (tetap dipakai org/reporting/team); auth/RBAC; navigasi; approval; absensi.

---

## Existing Architecture

### Relevant Frontend

- `frontend/src/lib/axios.ts` — `sicknessTypeApi`/`sicknessTypeAdminApi` (acuan), `usersApi` (`create`/`update` payload).
- `frontend/src/features/admin/MasterDataPage.tsx` — tab master data; perlu +2 tab.
- `frontend/src/features/admin/MasterDataPanel.tsx` — panel reusable (buat + toggle status).
- `frontend/src/features/users/UsersPage.tsx` — list + aksi; perlu hapus 3 kolom + aksi Lihat.
- `frontend/src/features/users/CreateUserDialog.tsx` — hapus dept/jabatan; tambah NIP + Kontrak + Penempatan.
- `frontend/src/features/users/EditUserDialog.tsx` — tambah NIP + Kontrak + Penempatan; dukung readOnly (Lihat).
- `frontend/src/features/users/QuotaAndScheduleSection.tsx` — perlu prop `disabled` untuk mode Lihat.
- `frontend/src/features/users/types.ts` — `UserListItem` perlu field baru.
- `frontend/src/features/org/OrgPicker.tsx` — pola select aktif.
- `contracts/` — perlu tipe `ContractTypeDto` / `PlacementDto` (+ response wrappers).

### Relevant Backend

- `backend/src/infrastructure/models/sickness-type.model.js` (acuan model master data).
- `backend/src/infrastructure/models/user.model.js` (tambah 3 field).
- `backend/src/domain/sickness-type.js` (acuan domain master data).
- `backend/src/infrastructure/repositories/sickness-type.repository.js` (acuan repository master data).
- `backend/src/application/sickness-type.service.js` (acuan service master data).
- `backend/src/application/user-admin.service.js` (createUser/updateUser/toUserDto/enrich).
- `backend/src/presentation/controllers/sickness-type.controller.js` (acuan controller admin).
- `backend/src/presentation/routes/sakit.routes.js` (acuan route admin + aktif).
- `backend/src/presentation/dto/user.dto.js` (tambah field).
- `backend/src/presentation/dto/sakit.dto.js` (acuan DTO master data).
- `backend/server.js` (composition root: wire repos/services/controllers/routes).

### Relevant Database

- `users` collection: tambah `nip` (String), `contractTypeId` (ObjectId ref `contract_types`), `placementId` (ObjectId ref `placements`).
- Collection baru: `contract_types`, `placements` (dibuat otomatis oleh Mongoose saat create pertama).
- Tidak ada migrasi data (field baru default kosong/null).

### Relevant API

- Baru: `GET/POST/PUT/:id, POST /:id/activate, POST /:id/deactivate` untuk `/api/v1/admin/contract-types` dan `/api/v1/admin/placements` (guard `platform:settings`); `GET /api/v1/contract-types` dan `GET /api/v1/placements` (aktif, authenticated).
- Ubah: `POST /api/v1/users` dan `PUT /api/v1/users/:id` — payload + response menambah `nip`, `contractTypeId`, `placementId`, `contractName`, `placementName`.

### Relevant Authentication / Authorization / RBAC

- Admin master data: reuse permission `platform:settings` (sama dengan tipe sakit/cuti).
- Daftar aktif untuk form user: authenticated only (sama dengan `/sickness-types`).
- Aksi Lihat user: reuse `users:view` (sudah di-route); verifikasi `PERMISSIONS.USERS_VIEW` ada di `contracts/permissions.ts`.
- Tidak ada permission/role baru.

### Relevant Navigation

- Tidak ada perubahan menu (Master Data sudah ada di sidebar; tab ditambah di dalam halaman).

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | **Affected** | Master data tab baru; form user (NIP/Kontrak/Penempatan); list user (hapus 3 kolom + aksi Lihat) |
| Backend | **Affected** | Master data baru (2 entitas) + user model/DTO/service |
| Database | **Affected (additive)** | 2 collection baru + 3 field baru di `users`; tanpa migrasi |
| API | **Affected** | Endpoint master data baru; payload/response user bertambah field |
| Authentication | Not Affected | Tidak ada perubahan alur login/token |
| Authorization / RBAC | Not Affected | Reuse `platform:settings` + `users:view`; tidak ada permission baru |
| Navigation | Not Affected | Menu tetap; hanya tab dalam halaman Master Data |
| Storage | Not Affected | — |
| Reports / Dashboard / Approval / Notifications | Not Affected | Field baru tidak dipakai modul lain |

---

## Functional Requirements

### FR-001: Master data KONTRAK — backend lengkap

**Type:** Backend / Database / API

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
Buat entitas master data KONTRAK mengikuti pola Tipe Sakit (tanpa alur PENDING/"Tambahkan sendiri"). Status hanya `ACTIVE`/`INACTIVE` (bisa dinonaktifkan). Data string: `name` (+`key`, `description` agar selaras dengan MasterDataPanel).

**Current Behavior:**
Tidak ada entitas/endpoint KONTRAK.

**Expected Behavior:**
CRUD + aktif/nonaktif via admin (`platform:settings`); daftar aktif untuk form user; audit `SETTINGS.CHANGED`.

**Affected Files (semua baru, kecuali server.js):**
- `backend/src/infrastructure/models/contract-type.model.js` (collection `contract_types`)
- `backend/src/domain/contract-type.js`
- `backend/src/infrastructure/repositories/contract-type.repository.js`
- `backend/src/application/contract-type.service.js`
- `backend/src/presentation/controllers/contract-type.controller.js`
- `backend/src/presentation/routes/contract-type.routes.js`
- `backend/src/presentation/dto/contract-type.dto.js`
- `backend/server.js` (wiring + mount)

**Implementation Instructions:**
1. **Model** (salin pola `sickness-type.model.js`): `key` (unique, uppercase), `name` (trim, required), `description` (default `""`), `status` enum `["ACTIVE","INACTIVE"]` default `ACTIVE` index, `updatedBy` (ObjectId ref User, default null), timestamps true, versionKey false.
2. **Domain** (`domain/contract-type.js`): `CONTRACT_TYPE_STATUS` (`ACTIVE`/`INACTIVE`), `validateContractTypeInput({ key, name })` (key uppercase `[A-Z][A-Z0-9_]*`, name min 2), `isActiveContractType(entity)`.
3. **Repository**: `findByKey`, `getById`, `create`, `update({name,description,updatedBy})`, `setStatus(id,status,updatedBy)`, `list({search,status})`, `listActive()` — salin `sickness-type.repository.js` tanpa logika PENDING/suggestedBy.
4. **Service** (salin `sickness-type.service.js`, buang suggest/PENDING): `listActive`, `list`, `create` (cek duplikat key → `ConflictError` `CONTRACT_TYPE_EXISTS`), `update`, `activate`, `deactivate`, `isActiveType(id)` (null-safe), `findById(id)` (null-safe), `toDto` (`id,key,name,description,status,updatedAt`). Audit action `SETTINGS.CHANGED` subject type `CONTRACT_TYPE`, metadata `{ changedFields: ["contractType"], kind }`.
5. **Controller**: `listActive`, `listAdmin`, `create`, `update`, `activate`, `deactivate` (salin pola `sickness-type.controller.js`; actor helper sama).
6. **Routes** (`contract-type.routes.js`): 
   - `createContractTypeRoutes` — `router.use(authenticate)`; `GET /` → `listActive` (dipakai form user).
   - `createContractTypeAdminRoutes` — `router.use(authenticate)` + `router.use(authorize("platform:settings"))`; `GET /` `POST /` `PUT /:id` `POST /:id/activate` `POST /:id/deactivate`, validasi DTO.
7. **DTO** (`contract-type.dto.js`): `createContractTypeDto` `{ key, name, description? }`, `updateContractTypeDto` `{ name?, description? }` (salin pola `sakit.dto.js` create/update).
8. **server.js wiring** (pola `sicknessType*`):
   - `const contractTypeRepository = new ContractTypeRepository();`
   - `const contractTypeService = new ContractTypeService({ contractTypeRepository, auditService });`
   - `const contractTypeController = new ContractTypeController({ contractTypeService });`
   - Mount: `app.use("/api/v1/contract-types", createContractTypeRoutes({ contractTypeController, authenticate, authorize }));`
   - Mount: `app.use("/api/v1/admin/contract-types", createContractTypeAdminRoutes({ contractTypeController, authenticate, authorize }));`
   - Tambahkan `contractTypeRepository` ke objek `repositories` yang di-return (agar bisa dipakai seed/test bila perlu).
9. Audit: setiap mutasi `SETTINGS.CHANGED`; jangan buat permission baru.

**Dependencies:**
- `AuditService` yang sudah ada di `buildApp`.

**Must Preserve:**
- Pola master data yang sudah ada (tipe sakit/cuti) — tidak mengubahnya.
- `platform:settings` guard.

**Acceptance Criteria:**
- [ ] `GET /api/v1/admin/contract-types` (token `platform:settings`) → daftar KONTRAK.
- [ ] `POST /api/v1/admin/contract-types` membuat entri; duplikat key → 409.
- [ ] `POST /api/v1/admin/contract-types/:id/deactivate` dan `/activate` berfungsi; entri INACTIVE tidak muncul di `GET /api/v1/contract-types` (aktif).
- [ ] `PUT /api/v1/admin/contract-types/:id` mengubah name/description.
- [ ] Mutasi tercatat di audit (SETTINGS.CHANGED).

---

### FR-002: Master data PENEMPATAN — backend lengkap

**Type:** Backend / Database / API

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
Identik dengan FR-001 untuk entitas PENEMPATAN (collection `placements`, model `Placement`, subject audit `PLACEMENT`, kode error `PLACEMENT_EXISTS`).

**Current Behavior:**
Tidak ada.

**Expected Behavior:**
CRUD + aktif/nonaktif; daftar aktif untuk form user.

**Affected Files (baru):**
- `backend/src/infrastructure/models/placement.model.js`
- `backend/src/domain/placement.js`
- `backend/src/infrastructure/repositories/placement.repository.js`
- `backend/src/application/placement.service.js`
- `backend/src/presentation/controllers/placement.controller.js`
- `backend/src/presentation/routes/placement.routes.js`
- `backend/src/presentation/dto/placement.dto.js`
- `backend/server.js` (wiring + mount)

**Implementation Instructions:**
1. Salin seluruh pola FR-001 dengan nama/domain `Placement`/`placement`.
2. Mount: `app.use("/api/v1/placements", ...)` dan `app.use("/api/v1/admin/placements", ...)`.
3. Tambahkan `placementRepository` ke `repositories`.

**Dependencies:**
- FR-001 (pola yang sama).

**Must Preserve:**
- Idem FR-001.

**Acceptance Criteria:**
- [ ] CRUD + aktif/nonaktif PENEMPATAN berfungsi via admin API.
- [ ] Daftar aktif (`GET /api/v1/placements`) hanya menampilkan ACTIVE.

---

### FR-003: User model + DTO + service — NIP, Kontrak, Penempatan (ObjectId + populate nama)

**Type:** Backend / Database / API

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
Tambahkan ke user: `nip` (string), `contractTypeId` (ObjectId → `contract_types`), `placementId` (ObjectId → `placements`). Backend menerima field ini di create/update, memvalidasi referensi AKTIF, menyimpannya, mengembalikannya beserta nama (`contractName`/`placementName`) yang di-populate (batch resolve, pola `loadRelationNames`).

**Current Behavior:**
User tidak punya field tersebut; DTO menolak; DTO respons tidak menampilkan.

**Expected Behavior:**
`POST/PUT /users` menerima `nip`, `contractTypeId`, `placementId`; respons user (list/get/create/update) menyertakan `nip`, `contractTypeId`, `placementId`, `contractName`, `placementName`.

**Affected Files:**
- `backend/src/infrastructure/models/user.model.js`
- `backend/src/presentation/dto/user.dto.js`
- `backend/src/application/user-admin.service.js`

**Implementation Instructions:**
1. **Model** (`user.model.js`), setelah blok `positionId` (jangan ubah field lama):
   ```js
   // NIP + master-data relations (Kontrak / Penempatan) — ObjectId refs that
   // are populated into display names by UserAdminService.
   nip: { type: String, default: "", trim: true },
   contractTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "ContractType", default: null, index: true },
   placementId: { type: mongoose.Schema.Types.ObjectId, ref: "Placement", default: null, index: true },
   ```
   - Jangan tambah index unik pada `nip` (tidak diminta).
2. **DTO** (`user.dto.js`):
   - `createUserDto` + `updateUserDto` tambah: `nip: z.string().trim().max(64).optional()`, `contractTypeId: z.string().min(1).optional().nullable()`, `placementId: z.string().min(1).optional().nullable()`.
3. **Service** (`user-admin.service.js`):
   - Tambah method `assertActiveMasterRefs({ contractTypeId, placementId })` — jika ada, pastikan entitas ada + `status === "ACTIVE"` (via `contractTypeService.isActiveType`/`placementService.isActiveType` atau repository); jika INACTIVE/not-found → `ConflictError` `MASTER_INACTIVE`/`MASTER_NOT_FOUND` (ikuti gaya pesan `assertActiveOrgRefs`).
   - `createUser`: panggil `assertActiveMasterRefs` (guard `if (this.contractTypeService && this.placementService)` — tetap aman bila deps null); simpan `nip: input.nip ?? ""`, `contractTypeId`, `placementId` di `userRepository.create`; sertakan di audit metadata.
   - `updateUser`: masukkan `nip`, `contractTypeId`, `placementId` ke `before`/`after` audit dan ke `userRepository.update`.
   - `toUserDto` (+ `getUser`/`enrichRoleKeys` normalized shape): tambah `nip: user.nip ?? ""`, `contractTypeId: user.contractTypeId?.toString?.() ?? null`, `placementId: user.placementId?.toString?.() ?? null`.
   - Perluas `loadRelationNames` (batch) agar memuat `contractName`/`placementName` (lookup `ContractTypeModel`/`PlacementModel` by ids — atau via `contractTypeService.findById`/`placementService.findById`; lebih baik repository `.findByIds` jika ada — jika tidak, buat helper lookup sederhana di service). Sertakan di map hasil sehingga `toUserDto` mengisi `contractName`/`placementName`.
   - Tambahkan deps baru pada constructor: `contractTypeService`, `placementService` (nullable — pola `orgRepository`).
4. **server.js**: saat membuat `UserAdminService`, oper `contractTypeService` + `placementService` (yang dibuat di FR-001/FR-002).
5. Jangan hapus `departmentId`/`positionId`/`managerId` dari model/DTO (dipakai org/reporting/team).

**Dependencies:**
- FR-001, FR-002 (service master data).

**Must Preserve:**
- Semua field user lama + perilaku `assertActiveOrgRefs`, quota, work schedule, roles, audit.
- `departmentName`/`positionName`/`managerName` tetap ada di respons (hanya UI yang tidak menampilkan lagi — FR-006).

**Acceptance Criteria:**
- [ ] `POST /api/v1/users` dengan `nip`, `contractTypeId` (AKTIF), `placementId` (AKTIF) → 201; respons berisi `nip/contractTypeId/placementId/contractName/placementName`.
- [ ] Mengirim `contractTypeId` INACTIVE/tidak ada → 409/400 dengan pesan bisnis jelas; user tidak jadi dibuat.
- [ ] `PUT /api/v1/users/:id` memperbarui `nip`/`contractTypeId`/`placementId`.
- [ ] `GET /api/v1/users` dan `GET /api/v1/users/:id` mengembalikan `contractName`/`placementName`.
- [ ] User lama (tanpa field baru) tetap tampil (`nip` = "", `contractTypeId` = null).

---

### FR-004: Frontend — API clients + Master Data UI (tab KONTRAK + PENEMPATAN)

**Type:** Frontend / UI

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
Tambahkan API clients untuk master data baru di `frontend/src/lib/axios.ts` dan 2 tab baru di `MasterDataPage.tsx` dengan reuse `MasterDataPanel`.

**Current Behavior:**
Hanya tab Tipe Cuti + Tipe Sakit.

**Expected Behavior:**
Tab "Kontrak" dan "Penempatan" — buat/aktif/nonaktif dengan panel yang sama.

**Affected Files:**
- `frontend/src/lib/axios.ts`
- `frontend/src/features/admin/MasterDataPage.tsx`
- `contracts/contract-type.ts` (baru), `contracts/placement.ts` (baru) — atau perluas file type yang ada

**Implementation Instructions:**
1. **Contract types** (`contracts/contract-type.ts`): `ContractTypeDto { id, key, name, description, status: "ACTIVE"|"INACTIVE", updatedAt? }`, `ContractTypeListResponse = ApiEnvelope<{ items: ContractTypeDto[] }>`, `ContractTypeResponse = ApiEnvelope<ContractTypeDto>`.
2. **axios.ts**: salin pola `sicknessTypeApi`/`sicknessTypeAdminApi`:
   - `contractTypeApi = { list: () => api.get<ContractTypeListResponse>("/contract-types") }`
   - `contractTypeAdminApi = { list: () => api.get<ContractTypeListResponse>("/admin/contract-types"), create: (body) => api.post<ContractTypeResponse>("/admin/contract-types", body), update: (id, body) => api.put<ContractTypeResponse>(`/admin/contract-types/${id}`, body), activate: (id) => api.post(`/admin/contract-types/${id}/activate`), deactivate: (id) => api.post(`/admin/contract-types/${id}/deactivate`) }`
   - Pola sama untuk `placementApi`/`placementAdminApi`.
3. **MasterDataPage.tsx**:
   - `MasterTab` → `"leave" | "sickness" | "contract" | "placement"`.
   - `TABS` tambah `{ key: "contract", label: "Kontrak" }` dan `{ key: "placement", label: "Penempatan" }`.
   - Tambah query `contractQuery` (`contractTypeAdminApi.list().then(r => r.data.data?.items ?? [])`) + `placementQuery`; invalidate per tab.
   - Render `<MasterDataPanel title="Kontrak" ...>` dan `<MasterDataPanel title="Penempatan" ...>` (showBalanceFields=false), dengan `onCreate`/`onActivate`/`onDeactivate` memanggil admin API + invalidate.

**Dependencies:**
- FR-001, FR-002 (endpoint).

**Must Preserve:**
- Tab Tipe Cuti/Tipe Sakit tetap berfungsi (tipe `MasterTab` diperluas tanpa merusak).
- `MasterDataPanel` tidak diubah (kecuali optional).

**Acceptance Criteria:**
- [ ] Tab Kontrak/Penempatan muncul dan bisa create + toggle status.
- [ ] Data baru muncul setelah create/invalidate (React Query).
- [ ] `npm run build` + `npm run lint` lolos.

---

### FR-005: Frontend — form Pengguna Baru & Edit (NIP + Kontrak + Penempatan, tanpa Departemen/Jabatan)

**Type:** Frontend / UI

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
- **CreateUserDialog**: hapus `DepartmentSelect`/`PositionSelect`; tambah field NIP (string) + `ContractTypeSelect` + `PlacementSelect` (aktif dari DB, tidak hardcode).
- **EditUserDialog**: tambah NIP + `ContractTypeSelect` + `PlacementSelect` (terisi nilai saat ini).

**Current Behavior:**
Create punya Departemen/Jabatan; keduanya tidak punya NIP/Kontrak/Penempatan.

**Expected Behavior:**
Form baru/edit menampilkan NIP + pilihan Kontrak + Penempatan; payload API menyertakan `nip`, `contractTypeId`, `placementId`.

**Affected Files:**
- `frontend/src/features/admin/MasterSelects.tsx` (baru)
- `frontend/src/features/users/CreateUserDialog.tsx`
- `frontend/src/features/users/EditUserDialog.tsx`
- `frontend/src/features/users/types.ts`
- `contracts/user.ts` (atau types yang dipakai `usersApi.create/update`)

**Implementation Instructions:**
1. **MasterSelects.tsx** (salin pola `OrgPicker`):
   - `ContractTypeSelect({ value, onChange })` → query `contractTypeApi.list()` (queryKey `["contract-types-active"]`), render `<select>` dengan opsi `contract.name` (value = id), opsi kosong "—".
   - `PlacementSelect({ value, onChange })` → query `placementApi.list()` (queryKey `["placements-active"]`).
   - Label: "Kontrak" dan "Penempatan".
2. **CreateUserDialog.tsx**:
   - Hapus import `DepartmentSelect, PositionSelect` dari `@/features/org/OrgPicker`; hapus `departmentId`/`positionId` dari state `form`.
   - Tambah state `form.nip = ""`, `form.contractTypeId = ""`, `form.placementId = ""`.
   - Render `<Input label="NIP" ...>` (string, maxLength 64) + `<ContractTypeSelect value={form.contractTypeId} onChange={(id) => update("contractTypeId", id)} />` + `<PlacementSelect ... />`.
   - Payload `usersApi.create`: kirim `nip: form.nip.trim() || undefined`, `contractTypeId: form.contractTypeId || null`, `placementId: form.placementId || null`; HAPUS `departmentId`/`positionId` dari payload.
3. **EditUserDialog.tsx**:
   - State `form` tambah `nip: user.nip ?? ""`, `contractTypeId: user.contractTypeId ?? ""`, `placementId: user.placementId ?? ""`.
   - Render NIP + ContractTypeSelect + PlacementSelect.
   - Payload `usersApi.update`: kirim `nip: form.nip.trim() || undefined`, `contractTypeId: form.contractTypeId || null`, `placementId: form.placementId || null`.
4. **types.ts** `UserListItem`: tambah `nip?: string`, `contractTypeId?: string | null`, `placementId?: string | null`, `contractName?: string | null`, `placementName?: string | null`.
5. Update tipe payload `usersApi.create/update` di `axios.ts` (body type) agar menerima field baru; jaga tetap opsional agar user lama kompatibel.
6. `ContractTypeSelect`/`PlacementSelect` harus tetap menampilkan nilai yang TIDAK aktif jika user lama masih memegangnya (jika perlu: tambahkan opsi "<nama> (nonaktif)" bila value terpilih tidak ada di daftar aktif) — minimal: jika value tidak ada di list, tetap render option dengan value tersebut agar form tidak "menghilangkan" data.

**Dependencies:**
- FR-004 (api clients), FR-003 (backend menerima field).

**Must Preserve:**
- Field lama lain: username/email/name/peran/password/jatah/jadwal.
- Perilaku `jatahCuti` + alasan + `updateWorkSchedule` di Edit.

**Acceptance Criteria:**
- [ ] Create dialog: tanpa Departemen/Jabatan; ada NIP + Kontrak + Penempatan (opsi dari DB, bukan hardcode).
- [ ] Edit dialog: NIP/Kontrak/Penempatan terisi nilai user saat ini dan bisa diubah.
- [ ] Create + Edit sukses tanpa error; payload berisi `nip`, `contractTypeId`, `placementId`.
- [ ] `npm run build` + `npm run lint` lolos.

---

### FR-006: Frontend — list Pengguna (hapus 3 kolom) + aksi Lihat (read-only, komponen sama dengan Edit)

**Type:** Frontend / UI

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
- Hapus kolom **Departemen, Jabatan, Manajer** dari tabel.
- Tambah aksi **"Lihat"** yang membuka komponen yang sama dengan Edit dalam mode read-only (tanpa tombol Simpan, menampilkan NIP/Kontrak/Penempatan).
- (Opsional) tambah kolom NIP di tabel agar data NIP terlihat (diperbolehkan — tidak diminta eksplisit; jika ditambahkan, tetap minimal).

**Current Behavior:**
Kolom Departemen/Jabatan/Manajer ada; aksi hanya Edit/Nonaktifkan/Reset/Aktifkan.

**Expected Behavior:**
Tabel tanpa 3 kolom tersebut; ada tombol "Lihat" (gating `users:view`) yang membuka dialog read-only berisi detail sama seperti Edit.

**Affected Files:**
- `frontend/src/features/users/UsersPage.tsx`
- `frontend/src/features/users/EditUserDialog.tsx` (tambah prop `readOnly`)
- `frontend/src/features/users/QuotaAndScheduleSection.tsx` (tambah prop `disabled`/readOnly)
- `frontend/src/features/users/types.ts`

**Implementation Instructions:**
1. **UsersPage.tsx**:
   - Hapus `<th>` Departemen, Jabatan, Manajer (baris 126-128) dan `<td>` terkait (140-148).
   - Tambah state `const [viewing, setViewing] = useState<UserListItem | null>(null);`.
   - Di kolom Aksi, sebelum tombol Edit: `<Can permission={PERMISSIONS.USERS_VIEW}><Button size="sm" variant="secondary" onClick={() => setViewing(user)}>Lihat</Button></Can>`.
     - Verifikasi `PERMISSIONS.USERS_VIEW` ada di `contracts/permissions.ts` (backend `users:view` sudah terdaftar). Jika tidak ada, tambahkan konstanta (manual mirror) — jangan menambah permission backend.
   - Render: `{viewing ? <EditUserDialog user={viewing} readOnly onClose={() => setViewing(null)} onSaved={() => setViewing(null)} /> : null}`.
2. **EditUserDialog.tsx**: tambah prop `readOnly = false`:
   - `title={readOnly ? `Lihat ${user.name}` : `Edit ${user.name}`}`.
   - Semua `Input`/select diberi `disabled={readOnly}`; `QuotaAndScheduleSection` diberi `disabled={readOnly}` (FR di bawah).
   - Tombol "Simpan" hanya dirender bila `!readOnly`; tombol "Batal" dirender selalu (label "Tutup" bila readOnly, opsional).
   - `handleSubmit` tidak terpanggil di mode readOnly (form tidak punya tombol submit).
   - Jaga seluruh hook tetap dipanggil (tidak ada conditional hook) — hanya UI yang berubah.
3. **QuotaAndScheduleSection.tsx**: tambah prop opsional `disabled = false`; set `disabled` pada semua input/select di dalamnya (atau bungkus dengan `<fieldset disabled>` bila komponen memungkinkan). Pastikan tidak memutus perilaku normal edit.
4. Jika menambahkan kolom NIP di tabel: `<th>NIP</th>` + `<td>{user.nip || "—"}</td>` (opsional; konsisten dengan minimal scope).

**Dependencies:**
- FR-005 (field baru tampil di dialog).

**Must Preserve:**
- Aksi Edit/Nonaktifkan/Reset/Aktifkan tetap.
- Gating permission aksi (Can) tetap.
- Alur save edit (quota reason, work schedule) tidak berubah di mode non-readOnly.

**Acceptance Criteria:**
- [ ] Tabel pengguna tanpa kolom Departemen/Jabatan/Manajer.
- [ ] Tombol "Lihat" muncul; dialog read-only menampilkan Nama/Email/NIP/Kontrak/Penempatan/Peran/Status/Jatah/Jadwal; tidak ada tombol Simpan; input nonaktif.
- [ ] Edit normal tetap berfungsi penuh (readOnly=false).
- [ ] `npm run build` + `npm run lint` lolos.

---

### FR-007: Testing end-to-end (backing service + unit/integration + build/lint)

**Type:** Testing / Verification

**Priority:** High

**Status:** Proposed

- [x] Implement requirement

**Description:**
Pastikan seluruh alur di atas teruji: unit test backend baru, integrasi API, build/lint frontend, dan skenario manual.

**Current Behavior:**
— (implementasi baru belum ada test).

**Expected Behavior:**
Test lulus; tidak ada regresi.

**Affected Files:**
- `backend/test/unit/contract-type.service.test.js` (baru)
- `backend/test/unit/placement.service.test.js` (baru)
- `backend/test/unit/user-admin.service.test.js` (perluas: create/update dengan nip/contractTypeId/placementId + validasi master ref)
- `backend/test/integration/*` (opsional: endpoint admin master data)
- `ai-project-context/TODO.md`

**Implementation Instructions:**
1. Tulis unit test service master data (create duplikat → conflict, update, activate/deactivate, isActiveType null-safe) mengikuti pola `test/unit/sickness-type.service.test.js` (jika ada) atau pola test service lain (in-memory fakes dari `test/helpers/fakes.js`).
2. Perluas unit test `user-admin.service.test.js`: create user dengan `nip`/`contractTypeId`/`placementId` valid → field tersimpan + `contractName`/`placementName` terisi; dengan master INACTIVE → error.
3. Jalankan `cd backend && npm run test:unit`.
4. Jalankan `cd frontend && npm run build` + `npm run lint`.
5. Skenario manual (untuk presentasi): buat KONTRAK + PENEMPATAN di Master Data → nonaktifkan satu → form user baru pilih aktif → buat user dengan NIP → edit user ganti kontrak/penempatan → Lihat user (read-only) → login user baru (mustChangePassword).

**Dependencies:**
- Semua FR sebelumnya.

**Must Preserve:**
- Seluruh test existing tetap hijau (tidak ada regresi).

**Acceptance Criteria:**
- [ ] `npm run test:unit` backend hijau (termasuk test baru).
- [ ] `npm run build` + `npm run lint` frontend hijau.
- [ ] Skenario manual presentasi berjalan tanpa error.

---

## API Changes

### Endpoint Changes

**Baru:**
```
GET    /api/v1/contract-types                # aktif, authenticated (form user)
GET    /api/v1/admin/contract-types          # platform:settings
POST   /api/v1/admin/contract-types          # platform:settings
PUT    /api/v1/admin/contract-types/:id      # platform:settings
POST   /api/v1/admin/contract-types/:id/activate    # platform:settings
POST   /api/v1/admin/contract-types/:id/deactivate  # platform:settings
GET    /api/v1/placements                    # aktif, authenticated
GET    /api/v1/admin/placements              # platform:settings
POST   /api/v1/admin/placements              # platform:settings
PUT    /api/v1/admin/placements/:id          # platform:settings
POST   /api/v1/admin/placements/:id/activate    # platform:settings
POST   /api/v1/admin/placements/:id/deactivate  # platform:settings
```

**Diubah (payload/response):**
```
POST /api/v1/users        → body + nip?, contractTypeId?, placementId?
                            response + nip, contractTypeId, placementId, contractName, placementName
PUT  /api/v1/users/:id    → body + nip?, contractTypeId?, placementId?
                            response + (sama)
GET  /api/v1/users        → items + field baru
GET  /api/v1/users/:id    → + field baru
```

### Request Changes

Lihat di atas. `departmentId`/`positionId`/`managerId` TETAP diterima (tidak dihapus dari DTO) — hanya tidak dikirim dari form frontend lagi.

### Response Changes

Tambahan field (additive) — klien lama tetap kompatibel.

### Error Handling

- Master INACTIVE/not-found pada assign user → `ConflictError`/`NotFoundError` dengan pesan bisnis (mis. `Kontrak yang dipilih tidak aktif.`).
- Duplikat key master → 409.
- Validasi DTO → 400 standar.

---

## Database Changes

### Existing Models

- `users`: tambah `nip` (String, default `""`), `contractTypeId` (ObjectId ref `ContractType`), `placementId` (ObjectId ref `Placement`). Additive, tanpa migrasi.

### Required Changes

- Collection baru `contract_types`, `placements` (Mongoose auto-create).

### Migration Requirements

Tidak ada. User lama otomatis `nip: ""`, refs `null`.

---

## Frontend Changes

### Pages

- `frontend/src/features/admin/MasterDataPage.tsx` — +2 tab.

### Components

- Baru: `frontend/src/features/admin/MasterSelects.tsx` (ContractTypeSelect, PlacementSelect).
- `frontend/src/features/users/UsersPage.tsx` — hapus kolom; + aksi Lihat.
- `frontend/src/features/users/CreateUserDialog.tsx` — NIP + Kontrak + Penempatan; hapus Dept/Jabatan.
- `frontend/src/features/users/EditUserDialog.tsx` — NIP + Kontrak + Penempatan; prop `readOnly`.
- `frontend/src/features/users/QuotaAndScheduleSection.tsx` — prop `disabled`.

### Hooks / State

- React Query baru untuk master aktif + admin.

### Forms / Validation

- NIP: input string opsional (maks 64).
- Kontrak/Penempatan: select ObjectId; kirim `null` bila kosong.

### UI / UX

- Label Indonesia: "NIP", "Kontrak", "Penempatan", aksi "Lihat", dialog title "Lihat <nama>".

---

## Backend Changes

### Routes

- `contract-type.routes.js`, `placement.routes.js` (baru); mount di `server.js`.

### Controllers

- `contract-type.controller.js`, `placement.controller.js` (baru).

### Services

- `contract-type.service.js`, `placement.service.js` (baru); `user-admin.service.js` (perluas).

### Validation

- DTO baru master data; `user.dto.js` diperluas.

### Authorization

- Admin master data: `platform:settings`. Daftar aktif: authenticated. Tidak ada permission baru.

---

## Cross-Layer Implementation Flow

```text
Master Data KONTRAK / PENEMPATAN
  MasterDataPage (tab) → admin API → controller → service → repository → contract_types/placements
                                                                          ↓ (isActive)
Form User Baru/Edit (NIP + ContractTypeSelect/PlacementSelect)
  → POST/PUT /api/v1/users { nip, contractTypeId, placementId }
  → user.dto (zod) → UserAdminService (assertActiveMasterRefs → persist)
  → users doc { nip, contractTypeId, placementId }
  → toUserDto + loadRelationNames → contractName/placementName
  → UsersPage list (tanpa dept/jabatan/manager; aksi Lihat → EditUserDialog readOnly)
```

---

## Regression Protection

- `departmentId`/`positionId`/`managerId` di model + DTO + service TIDAK dihapus (dipakai Org, ReportingLine, ManagerTeam, dashboard, dsb.) — hanya UI form/kolom yang dihapus.
- Perilaku create/edit user lama (roles, temp password, jatah, jadwal, alasan jatah) tidak berubah.
- Master data tipe cuti/sakit tidak disentuh.
- Auth/RBAC/approval/absensi/report tidak disentuh.
- User lama (tanpa field baru) tetap valid.
- Audit flow (`USER.CREATED`/`USER.UPDATED`/`SETTINGS.CHANGED`) tetap.

---

## Edge Cases

- **Master INACTIVE dipilih**: backend menolak dengan pesan jelas; frontend hanya menampilkan daftar aktif (plus nilai lama user yang mungkin nonaktif).
- **User lama memegang contractTypeId yang kini INACTIVE**: `contractName` tetap di-populate dari dokumen (history terjaga); select menampilkan opsi lama (nonaktif) agar tidak "hilang".
- **NIP kosong/duplikat**: NIP tidak unik di level DB (tidak diminta); tidak ada validasi duplikat.
- **Delete master**: tidak ada delete fisik — hanya deactivate (history preserved).
- **readOnly dialog**: semua hook tetap dipanggil; tidak ada conditional hooks; tidak ada tombol submit.
- **`PERMISSIONS.USERS_VIEW`**: verifikasi ada di `contracts/permissions.ts`; bila hilang tambahkan konstanta saja (mirror `users:view` backend yang sudah ada).

---

## Testing / Verification

### Frontend

- [ ] `npm run build` (tsc + vite) hijau.
- [ ] `npm run lint` hijau.
- [ ] Tab Kontrak/Penempatan create + toggle.
- [ ] Create/Edit user dengan NIP + Kontrak + Penempatan.
- [ ] Aksi Lihat read-only (tanpa Simpan, menampilkan NIP/Kontrak/Penempatan).
- [ ] List tanpa kolom Departemen/Jabatan/Manajer.

### Backend

- [ ] `cd backend && npm run test:unit` hijau.
- [ ] Unit test master data + user-admin (create/update dengan refs).
- [ ] (Opsional) integrasi API admin master data.

### API

- [ ] `POST /users` + `PUT /users/:id` dengan `nip`/`contractTypeId`/`placementId`.
- [ ] `GET /users`, `GET /users/:id` mengembalikan `contractName`/`placementName`.
- [ ] Admin master data CRUD + activate/deactivate.

### Database

- [ ] `contract_types`, `placements` terbentuk; `users` menyimpan ObjectId.
- [ ] User lama tetap terbaca (`nip` "", refs null).

### RBAC

- [ ] Hanya `platform:settings` yang bisa manage master data.
- [ ] Daftar aktif hanya butuh auth (bukan admin).

### Regression

- [ ] Tipe Cuti/Tipe Sakit tetap jalan.
- [ ] Edit user (jatah + alasan + jadwal) tetap jalan.
- [ ] Manager/team/reporting tetap jalan (field dept/pos/manager tidak dihapus).

---

## Implementation Order

1. **FR-001** — master data KONTRAK backend.
2. **FR-002** — master data PENEMPATAN backend (pola sama; bisa paralel dengan FR-001).
3. **FR-003** — user model/DTO/service (depend: FR-001/002 service untuk validasi aktif).
4. **FR-004** — frontend API clients + tab Master Data (depend: FR-001/002).
5. **FR-005** — form user baru/edit (depend: FR-003, FR-004).
6. **FR-006** — list + aksi Lihat (depend: FR-005).
7. **FR-007** — testing end-to-end (depend: semua).

Catatan: FR-001/FR-002 independen; FR-003 bergantung pada service master data; FR-004-006 berurutan di frontend.

---

## Developer Notes

- **Jangan hapus `departmentId`/`positionId`/`managerId`** dari backend — banyak modul bergantung padanya. Hanya UI (form + kolom) yang dibersihkan sesuai permintaan.
- **Populate**: gunakan pola batch resolve yang sudah ada (`loadRelationNames`/`enrichRoleKeys`) untuk `contractName`/`placementName`, bukan menambah `.populate()` baru di query — konsisten dengan arsitektur repo.
- **Naming konsisten**: `ContractType`/`contract_types`/`contractTypeId` dan `Placement`/`placements`/`placementId`. Jangan pakai `Kontrak`/`Penempatan` sebagai identifier kode.
- **MasterDataPanel** sudah reusable; JANGAN fork/duplikasi panel — cukup tambah tab + query.
- **Aksi Lihat** = prop `readOnly` pada `EditUserDialog` (sesuai permintaan "komponen yang sama dengan Edit"), bukan dialog baru.
- **Testing hari ini**: pastikan `npm run test:unit` (backend) dan `npm run build` + `npm run lint` (frontend) hijau SEBELUM presentasi; jalankan juga skenario manual utama.
- **Tidak ada permission baru** — reuse `platform:settings`, `users:view`, `users:create`, `users:edit`.
- **Excel import massal (74 karyawan) BUKAN bagian request ini** — setelah fitur ini, master data + field user siap diisi; import massal dapat menjadi task lanjutan (lihat TODO sebelumnya `seed-tad-employees`).

---

## Definition of Done

- [ ] FR-001: Master data KONTRAK backend lengkap (CRUD + aktif/nonaktif + audit + endpoint aktif).
- [ ] FR-002: Master data PENEMPATAN backend lengkap.
- [ ] FR-003: User model/DTO/service menerima & mengembalikan `nip`, `contractTypeId`, `placementId`, `contractName`, `placementName`; validasi master aktif.
- [ ] FR-004: Tab Kontrak + Penempatan di Master Data (API clients + UI) berfungsi.
- [ ] FR-005: Form user baru/edit punya NIP + Kontrak + Penempatan (dari DB, ObjectId), tanpa Departemen/Jabatan di form baru.
- [ ] FR-006: List user tanpa kolom Departemen/Jabatan/Manajer; aksi Lihat read-only berfungsi (tanpa Simpan).
- [ ] FR-007: Backend unit tests, frontend build + lint hijau; skenario manual presentasi lulus.
- [ ] Tidak ada regresi pada tipe cuti/sakit, edit user lama, org/reporting/team, auth/RBAC.
- [ ] `departmentId`/`positionId`/`managerId` tetap ada di backend (tidak dihapus).

---

## Implementation Summary

### Completed

- FR-001 — Master data KONTRAK backend lengkap (CRUD + aktif/nonaktif + audit + endpoint aktif)
- FR-002 — Master data PENEMPATAN backend lengkap
- FR-003 — User model/DTO/service menerima & mengembalikan `nip`, `contractTypeId`, `placementId`, `contractName`, `placementName`; validasi master aktif
- FR-004 — Tab Kontrak + Penempatan di Master Data (API clients + UI) berfungsi
- FR-005 — Form user baru/edit punya NIP + Kontrak + Penempatan (dari DB, ObjectId), tanpa Departemen/Jabatan di form baru
- FR-006 — List user tanpa kolom Departemen/Jabatan/Manajer; aksi Lihat read-only berfungsi (tanpa Simpan)
- FR-007 — Backend unit tests, frontend build + lint hijau

### Files Changed

Backend (new):

- `backend/src/infrastructure/models/contract-type.model.js` (FR-001)
- `backend/src/domain/contract-type.js` (FR-001)
- `backend/src/infrastructure/repositories/contract-type.repository.js` (FR-001)
- `backend/src/application/contract-type.service.js` (FR-001)
- `backend/src/presentation/controllers/contract-type.controller.js` (FR-001)
- `backend/src/presentation/routes/contract-type.routes.js` (FR-001)
- `backend/src/presentation/dto/contract-type.dto.js` (FR-001)
- `backend/src/infrastructure/models/placement.model.js` (FR-002)
- `backend/src/domain/placement.js` (FR-002)
- `backend/src/infrastructure/repositories/placement.repository.js` (FR-002)
- `backend/src/application/placement.service.js` (FR-002)
- `backend/src/presentation/controllers/placement.controller.js` (FR-002)
- `backend/src/presentation/routes/placement.routes.js` (FR-002)
- `backend/src/presentation/dto/placement.dto.js` (FR-002)
- `backend/test/unit/contract-type.service.test.js` (FR-007)
- `backend/test/unit/placement.service.test.js` (FR-007)

Backend (modified):

- `backend/src/infrastructure/models/user.model.js` (+nip/contractTypeId/placementId) (FR-003)
- `backend/src/presentation/dto/user.dto.js` (FR-003)
- `backend/src/application/user-admin.service.js` (assertActiveMasterRefs, create/update persistence + audit, loadRelationNames, toUserDto) (FR-003)
- `backend/src/infrastructure/repositories/user.repository.js` (create/update accept new fields) (FR-003)
- `backend/server.js` (wiring: 2 repos, 2 services, 2 controllers, 4 route mounts, UserAdminService deps, repositories return) (FR-001/002/003)
- `backend/test/helpers/fakes.js` (InMemoryUserRepository create/update accept new fields) (FR-007)

Kontrak:

- `contracts/contract-type.ts` (FR-004)
- `contracts/placement.ts` (FR-004)

Frontend:

- `frontend/src/lib/axios.ts` (contractTypeApi/AdminApi, placementApi/AdminApi, UserAdminDto + payload types) (FR-004)
- `frontend/src/features/admin/MasterDataPage.tsx` (+2 tabs) (FR-004)
- `frontend/src/features/admin/MasterDataPanel.tsx` (`isSystem` optional) (FR-004)
- `frontend/src/features/admin/MasterSelects.tsx` (new: ContractTypeSelect, PlacementSelect) (FR-005)
- `frontend/src/features/users/CreateUserDialog.tsx` (remove dept/position, add NIP/Kontrak/Penempatan) (FR-005)
- `frontend/src/features/users/EditUserDialog.tsx` (NIP/Kontrak/Penempatan + readOnly prop) (FR-005/006)
- `frontend/src/features/users/QuotaAndScheduleSection.tsx` (disabled prop) (FR-006)
- `frontend/src/features/users/UsersPage.tsx` (remove 3 columns, add NIP column + Lihat action) (FR-006)
- `frontend/src/features/users/types.ts` (UserListItem new fields) (FR-005)

### Database Changes

- Additive only: `users` gains `nip` (String), `contractTypeId` (ObjectId ref ContractType), `placementId` (ObjectId ref Placement). New collections `contract_types` and `placements` auto-created by Mongoose on first write. No migration required.

### API Changes

- New: `GET/POST/PUT/:id, POST /:id/activate, POST /:id/deactivate` for `/api/v1/admin/contract-types` and `/api/v1/admin/placements` (guard `platform:settings`); `GET /api/v1/contract-types` and `GET /api/v1/placements` (active, authenticated).
- Modified: `POST/PUT /users` accept `nip`, `contractTypeId`, `placementId`; user responses include `nip`, `contractTypeId`, `placementId`, `contractName`, `placementName`.

### Verification

- [x] Backend unit suite: 748 tests, 747 pass — 1 pre-existing unrelated failure (`request.service.test.js:237` `listMine` summary, documented earlier)
- [x] New unit tests: contract-type.service.test.js (6), placement.service.test.js (6), user-admin.service.test.js +5 master-ref tests — all pass
- [x] Frontend `tsc -b`: clean; `eslint .`: clean; `vite build`: succeeds
- [x] API smoke test (live, superadmin token): admin master-data CRUD endpoints return 200/201; active lists return only ACTIVE records
- [x] RBAC: admin endpoints require `platform:settings`; active lists require only authentication
- [x] Regression: dept/position/manager fields remain in backend model/DTO/API (only UI columns/fields removed per request); sickness/leave master data untouched; legacy users without new fields serialize as `nip: ""`, refs `null`
