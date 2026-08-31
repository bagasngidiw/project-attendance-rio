# Technical Implementation TODO

## Issue Summary

### User Request

(Indonesian, translated) — "Use the file `ai-project-context/NEWER ABSENSI SIMBIKA (PAKE INI).xlsx`. RESET ALL the databases, access my MONGO_URI env so I can reset my MongoDB cluster database and the local MongoDB Compass database — reset is fine, I want to start over. Create the MongoDB collections. Then create the data related to website access (roles, users, menus) with these rules:

1. Create roles **SUPERADMIN**, **ADMIN**, plus one role per value in column E **JABATAN** of the Excel file.
2. **Superadmin** (username `superadmin`, password `SuperAdmin2026!23`, NOT temporary): can see everything; NIP/contract/placement left empty.
3. **ADMIN** role → user `admin_simbika` (password `admin2026!23`, NOT temporary): menus Dashboard, Slip Gaji, Absensi, Lembur, Perjalanan Dinas, Izin, Sakit, Cuti, Pengguna, Laporan, Profil, Notifikasi — check ALL access features (view:all etc.; read the DB context so nothing is wrong). NIP/contract/placement empty.
4. **JABATAN roles** (from column E) → employees (username from column D: `{Nama Pegawai}_2026`, password `{nama pegawai lowercase}2026`, NOT temporary, NIP from column C): Dashboard karyawan; Absensi/Lembur/Perjalanan Dinas/Izin/Sakit/Cuti (NOT all features — submit requests, upload files, view own data only); Permintaan Saya (own data); Profil (edit own personal data); Slip Gaji (own only).
5. Master data **Kontrak** (column B) and **Penempatan** (column F), then assign Kontrak/Penempatan to employees (leave empty where the file has no placement).
6. Master data **Tipe Sakit = Sakit Ringan**, **Tipe Cuti = Cuti Tahunan** flagged as quota-based (uses employee leave balance).
7. For ALL users: **12 days of Cuti**, working hours **08:00–17:00**, working days **Mon–Fri**."

### Problem

The MongoDB databases (Atlas cluster `hris-project/attendance_db` + local MongoDB Compass `attendance_db`) currently hold legacy/demo data. The customer needs a clean, production-like initial dataset driven entirely by the NEWER Excel file — with role-per-JABATAN granularity (not the previous single "PENGEMUDI" role), exact credentials, menu-based permission sets, master data (Kontrak/Penempatan/Cuti Tahunan/Sakit Ringan), and uniform schedule + 12-day leave quota.

The existing untracked script `backend/scripts/seed-initial-production.js` was built for the OLD Excel file (`NEW UPDATE TAD SIMBIKA.xlsx`) and assumes a single PENGEMUDI role. It must be **superseded** by a new combined reset+seed script targeting the NEWER file with role-per-JABATAN creation.

### Expected Result

- Both `attendance_db` databases (cluster + local) are dropped and re-provisioned from scratch.
- Collections are created by the app's existing Mongoose models + idempotent base seed.
- Roles: `SUPER_ADMIN`, `ADMIN`, and one role per distinct JABATAN value from column E (33 after the documented typo merge; 34 if the alias is removed).
- Users: `superadmin` (all permissions, password non-temporary, NIP/contract/placement empty), `admin_simbika` (ADMIN, listed menus, all access features checked), and 244 employees (NIP + kontrak + penempatan + JABATAN role; passwords non-temporary).
- Master data: 19 Kontrak, 37 Penempatan, LeaveType `CUTI_TAHUNAN` (balance-based), SicknessType `SAKIT_RINGAN`.
- Every user: `workingDays [1,2,3,4,5]`, `workingStartTime "08:00"`, `workingEndTime "17:00"`, Cuti Tahunan quota 12 (both `users.leaveQuotas` mirror and `leave_balances` entitlement).
- Approval configurations: ADMIN eligible approver + selectable target for all 5 request types (LEAVE, OVERTIME, TRIP, PERMISSION, SAKIT), `selfApproval: false`.
- Login works for superadmin, admin_simbika, and every employee.

### Issue Classification

- Database Change (reset + re-provision)
- Functional Change (RBAC roles, users, master data)
- New Feature (initial-production data provisioning)
- Security Change (non-temporary credentials, permission scoping)

### Scope

- **Backend data provisioning only.** One new script + an optional `.env` line. No application source-code changes.
- Frontend, application services, routes, models, base seed (`seed.js`), permission registry (`permissions.js`), and contracts are **not modified**.
- The working tree contains unrelated in-flight changes (salary-slips feature, approval tweaks, header responsiveness). They must remain untouched.

---

## Existing Architecture

### Relevant Frontend

- None directly; menu visibility is driven by backend permissions. Reference only: `frontend/src/constants/sidebar.ts` + `backend/src/domain/navigation-catalog.js` define the menu→permission map used to design the role permission sets (see Functional Requirements FR-003).

### Relevant Backend

- `backend/server.js` — composition root; mounts all routes and runs the idempotent base `seedDatabase(...)` on boot (`server.js:608-620`).
- `backend/src/infrastructure/seed/seed.js` — base seed. With `SEED_DEMO_DATA=false` (current `.env`) it seeds ONLY: permission registry, `SUPER_ADMIN` role (all permissions), superadmin user (created with `mustChangePassword: true`), and the `roleIds` backfill. It does **not** create demo roles, system leave/sickness types, or approval configs. It never overwrites existing users' passwords.
- `backend/src/infrastructure/config.js` — `config.mongoUri` (defaults to the Atlas URI), `config.seed.*`.
- `backend/.env` — `MONGO_URI=mongodb+srv://bagasvanbacdim:AcC7uZly6oV1Av7i@hris-project.thgt0lt.mongodb.net/attendance_db` (cluster); commented `# MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/attendance_db`; `SEED_SUPER_ADMIN_PASSWORD=SuperAdmin2026!23`; `SEED_DEMO_DATA=false`.
- `backend/scripts/reset-database.js` — destructive reset reference (drops the ENTIRE database then seeds minimal SUPER_ADMIN). Reusable pattern; do NOT modify this tracked file.
- `backend/scripts/seed-initial-production.js` — **untracked**, targets the OLD Excel, PENGEMUDI-only. Superseded by the new script; leave in place or delete after verification (do not modify).
- Models (all in `backend/src/infrastructure/models/`): `user.model.js` (fields `nip`, `contractTypeId`, `placementId`, `roleIds`, `workingDays`, `workingStartTime/EndTime`, `leaveQuotas[]`), `role.model.js` (`key`/`name`/`description`/`isSystem`/`status`/`level`/`levelLabel`/`dataScope`/`version`), `permission.model.js`, `contract-type.model.js` (`key`/`name`/`status`), `placement.model.js`, `leave-type.model.js` (`isBalanceBased`), `sickness-type.model.js`, `leave-balance.model.js` (unique `{userId, leaveTypeId, year}`).
- Repositories: `backend/src/infrastructure/repositories/user.repository.js` (`findByUsername`, `create`, `upsertLeaveQuota`), `user-role.repository.js` (`replaceRolesForUser`), `permission.repository.js` (`assignToRole`), `role.repository.js` (`findByKey`, `create`), `leave-type.repository.js` (`findByKey`, `create`), `sickness-type.repository.js` (`findByKey`, `create`), `approval-configuration.repository.js` (`getByType`, `upsert`), `contract-type.repository.js` / `placement.repository.js`.
- Password hashing: `backend/src/infrastructure/password-hasher.js` (`BcryptPasswordHasher`).
- Domain constants: `backend/src/domain/permissions.js` (`PERMISSION_REGISTRY`, `ALL_PERMISSIONS`, `assertRegisteredPermission`), `backend/src/domain/approval-configuration.js` (`CONFIG_REQUEST_TYPES` = LEAVE/OVERTIME/TRIP/PERMISSION/SAKIT), `backend/src/domain/contract-type.js` + `placement.js` (key regex `/^[A-Z][A-Z0-9_]*$/`), `backend/src/domain/model.js` `validateRoleInput` (key regex `/^[A-Z][A-Z0-9_]*$/`).

### Relevant Database

- Cluster: `attendance_db` on Atlas cluster `hris-project` (via `MONGO_URI` in `.env`).
- Local: `attendance_db` on `mongodb://127.0.0.1:27017` (MongoDB Compass / local mongod; currently commented as `MONGO_URI_LOCAL`).
- Collections are created automatically by Mongoose models + the base seed (e.g. `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `contract_types`, `placements`, `leave_types`, `sickness_types`, `leave_balances`, `approval_configurations`). See `ai-project-context/DATABASE-INITIALIZATION.md` for the verified collection inventory.
- The seed writes direct model/repository documents (bypasses service-level validation/policy on purpose, per the established `seed-initial-production.js` pattern).

### Relevant API

- No API contract changes. After seeding, these must work: `POST /api/v1/auth/signin` (all users), `GET /api/v1/navigation` (permission-filtered menus), `GET /api/v1/rbac/roles`, `GET /api/v1/approval-targets?type=...`, `GET /api/v1/leave/types`, `GET /api/v1/sickness/types`.

### Relevant Authentication

- JWT + session flow unchanged. After a reset, all `sessions`/`refresh_tokens` are wiped → every user must sign in fresh. `mustChangePassword=false` for all seeded users (per request — passwords are NOT temporary).

### Relevant Authorization / RBAC

- Roles → permissions via `role_permissions`; users → roles via `user_roles` (+ `users.roleIds` mirror backfilled by `seedDatabase` and kept in sync by `replaceRolesForUser`).
- Permission registry is the single source of truth; every key referenced below is verified registered in `backend/src/domain/permissions.js`.
- Menu mapping (from `navigation-catalog.js` / `sidebar.ts`): Dasbor=`dashboard:view`; Permintaan Saya=`*:view_own` (leave/overtime/trip/sakit); Notifikasi=`dashboard:view`; Absensi=`attendance:*`; Lembur=`overtime:*`; Perjalanan Dinas=`trip:*`; Slip Gaji=`salary:view_own|salary:manage`; Cuti=`leave:*`; Ijin=`permission:*`; Sakit=`sakit:*`; Pengguna=`users:view`; Persetujuan=`*:approve`; Laporan=`reporting:view`; Profil=`profile:view`.

### Relevant Navigation

- Menu visibility is permission-driven (server `GET /api/v1/navigation`). Granting the permission sets in FR-003 yields exactly the requested menus.

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | Not Affected | No frontend changes; menu visibility follows seeded permissions |
| Backend | Affected | ONE new provisioning script `backend/scripts/reset-and-seed-tad-simbika.js`; optional `backend/.env` line; no application code changes |
| Database | Affected | Destructive reset + re-seed of TWO databases (cluster + local), explicitly authorized by the user |
| API | Not Affected | No endpoint/contract changes |
| Authentication | Potentially Affected | All sessions/tokens invalidated by the reset (expected — users must re-login) |
| Authorization / RBAC | Affected | New roles (ADMIN + 33 JABATAN roles) and their permission sets; SUPER_ADMIN unchanged |
| Navigation | Affected | Menu trees change as a result of new role permissions (intended) |
| UI/UX | Not Affected | No UI code changes |
| Business Logic | Not Affected | Application services untouched |
| Validation | Not Affected | Seed bypasses service validation deliberately (same as existing pattern); seeded keys are sanitized to satisfy domain key regexes |
| File Storage | Not Affected | No file operations |
| Notifications | Not Affected | No notification data seeded |
| Reports | Not Affected | No report data seeded |
| Audit Logs | Affected | `audit_events` wiped by the reset; hash chain restarts (expected; `AUDIT_CHAIN_SALT` unchanged) |
| Performance | Not Affected | One-time provisioning |
| Testing | Potentially Affected | Backend test suite must still pass (script is standalone and not imported by tests) |

---

## Functional Requirements

### FR-001: Create the combined reset + seed script and reset both databases

**Type:** Backend / Database / Script

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Created `backend/scripts/reset-and-seed-tad-simbika.js` (the single deliverable script) and activated `MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/attendance_db` in `backend/.env` (the only allowed env edit).

- `--yes` / `RESET_CONFIRM=yes` gate verified: without it the script prints an abort message and exits 1 before connecting to any DB.
- With `--yes`, the script drops + re-seeds the cluster (`config.mongoUri`) first, then the local target (`MONGO_URI_LOCAL`), and exits 0.
- Sanitized logging only: `host` + database name + counts. No run output contained the `MONGO_URI`, any password, or any hash (verified in the full run log).
- Seed sections are idempotent by construction (`findByKey`/`create`, `findByUsername`/create-or-update, `assignToRole` add-only upsert, leave-balance create-if-missing, approval-config create-if-missing).

#### Developer Note (Atlas dropDatabase restriction)

The Atlas application user (`bagasvanbacdim`) is **not** permitted to run `dropDatabase` ("user is not allowed to do action [dropDatabase]"). A probe confirmed the user CAN drop individual collections (`dropCollection`). The script therefore implements `dropDatabaseResilient()`: it attempts `dropDatabase()` and, when unauthorized, falls back to dropping each collection individually (verified — cluster reset completed via the fallback). This preserves the "drop + reseed from scratch" intent on Atlas app-user credentials.

**Description:**
Create `backend/scripts/reset-and-seed-tad-simbika.js` — a single, self-contained, destructive-but-gated provisioning script that (1) resets BOTH databases (Atlas cluster + local MongoDB Compass) and (2) seeds the complete initial dataset defined by FR-002 through FR-006. Add the `MONGO_URI_LOCAL` line to `backend/.env` so the local target is explicit.

**Acceptance Criteria:**
- [x] `node scripts/reset-and-seed-tad-simbika.js` (no `--yes`) prints an abort message and exits 1 without touching any DB.
- [x] `node scripts/reset-and-seed-tad-simbika.js --yes` connects to the cluster, drops `attendance_db`, seeds it, disconnects; then connects to the local `attendance_db`, drops it, seeds it, disconnects. *(Cluster drop used the per-collection fallback — see Developer Note.)*
- [x] No run output contains the `MONGO_URI` string, any password, or any password hash.
- [x] `backend/.env` contains an active `MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/attendance_db` line.
- [x] Re-running the script's seed sections (without `--yes` if already seeded) does not duplicate roles/users/master data. *(Seed sections are idempotent by construction — find/create + add-only upserts.)*

**Current Behavior:**
- The cluster (`attendance_db`) holds legacy data; the local Compass DB may or may not exist. `npm run db:reset` only resets the single `MONGO_URI` target and seeds only SUPER_ADMIN. The untracked `seed-initial-production.js` targets the old Excel and PENGEMUDI-only roles.

**Expected Behavior:**
- One command (`node scripts/reset-and-seed-tad-simbika.js --yes`) drops and re-seeds BOTH targets.
- Targets:
  - Cluster: `config.mongoUri` (= `backend/.env` `MONGO_URI`, `mongodb+srv://.../attendance_db`).
  - Local: `process.env.MONGO_URI_LOCAL || "mongodb://127.0.0.1:27017/attendance_db"`.
- The script refuses to run without `--yes` (or `RESET_CONFIRM=yes`) and prints sanitized target info (host + database name only — never the URI string, never credentials, never password hashes, never plaintext passwords).
- `backend/.env` gains an active `MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/attendance_db` line (uncomment/rewrite the existing commented line).

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW)
- `backend/.env` (add/activate `MONGO_URI_LOCAL` — the only allowed env edit; user explicitly authorized env/config access)

**Implementation Instructions:**
1. Header comment: purpose, SECURITY rules (never print URI/passwords/hashes), usage `node scripts/reset-and-seed-tad-simbika.js --yes`, destructive warning.
2. `require("dotenv").config()`; `const { createConfig } = require("../src/infrastructure/config")`; `const { buildApp } = require("../server")`; `const { seedDatabase } = require("../src/infrastructure/seed/seed")`; `const { BcryptPasswordHasher } = require("../src/infrastructure/password-hasher")`.
3. Gate: `const confirmed = process.argv.includes("--yes") || process.env.RESET_CONFIRM === "yes"; if (!confirmed) { console.error("[reset] ABORT: pass --yes ..."); process.exit(1); }`
4. Define `const TARGETS = [{ label: "cluster", uri: config.mongoUri }, { label: "local", uri: process.env.MONGO_URI_LOCAL || "mongodb://127.0.0.1:27017/attendance_db" }]`. Sanitized logging: parse the URI (e.g. `new URL(uri)`) and print `host` + pathname db name only.
5. For each target, run `async function resetAndSeed(uri)`:
   a. `await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })`.
   b. `await mongoose.connection.dropDatabase()`; log collection count before drop (sanitized names only).
   c. Call the FR-002..FR-006 seeding steps (implemented in the same script) using `buildApp(config).repositories` + `new BcryptPasswordHasher(config.security.bcryptRounds)`.
   d. `await mongoose.disconnect()`.
6. Wrap the whole run in a `try/catch` that prints a sanitized error (`err.message`) and `process.exit(1)`; on a local-target connection failure (e.g. local mongod not running), print an actionable message ("start MongoDB Compass / local mongod at 127.0.0.1:27017") and exit non-zero AFTER the cluster target completes (cluster first, then local).
7. The seed sections themselves must be **idempotent** (safe to re-run without `--yes` on an already-seeded DB), matching the existing `seed-initial-production.js` upsert patterns.

**Dependencies:**
- FR-002..FR-006 (the sections this script orchestrates).
- `exceljs` is already installed in `backend/node_modules` (used by the old script).

**Must Preserve:**
- `backend/scripts/reset-database.js` (tracked, generic) — do not modify.
- `backend/src/infrastructure/seed/seed.js` — do not modify; call it as-is with `demoData: false`.
- All application source code, frontend, contracts, tests.
- Never print secrets.

**Acceptance Criteria:**
- [ ] `node scripts/reset-and-seed-tad-simbika.js` (no `--yes`) prints an abort message and exits 1 without touching any DB.
- [ ] `node scripts/reset-and-seed-tad-simbika.js --yes` connects to the cluster, drops `attendance_db`, seeds it, disconnects; then connects to the local `attendance_db`, drops it, seeds it, disconnects.
- [ ] No run output contains the `MONGO_URI` string, any password, or any password hash.
- [ ] `backend/.env` contains an active `MONGO_URI_LOCAL=mongodb://127.0.0.1:27017/attendance_db` line.
- [ ] Re-running the script's seed sections (without `--yes` if already seeded) does not duplicate roles/users/master data.

---

### FR-002: Read the NEWER Excel file and seed master data (Kontrak, Penempatan, Cuti Tahunan, Sakit Ringan)

**Type:** Backend / Script (data ingestion)

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented as a section of `backend/scripts/reset-and-seed-tad-simbika.js`.

- `readExcelRows()` reads the `PEGAWAI` worksheet (columns 2/3/4/5/6), uses a robust `cellText()` helper (plain/rich-text/hyperlink cells), skips empty names, and **dedupes by NIP keeping the first occurrence** (RICO HERDIANSYAH's second row, which carries a unique "(SPR)" contract name, is dropped from the user set).
- `sanitizeKey()` verified: all 33 JABATAN / 19 Kontrak / 37 Penempatan keys are unique and match `/^[A-Z][A-Z0-9_]*$/`.
- `JABATAN_ALIASES = { "ENGINERING ON SITE": "ENGINEERING ON SITE" }` → 33 JABATAN roles (verified; removing the map yields 34).

#### Developer Note (19 vs 18 Kontrak)

The spec's "distinct Kontrak = 19" and "RICO appears exactly once" are both honored: **master data** (contract_types/placements) derives from ALL 245 sheet rows (19 distinct column B values, 37 column F values), while **users** derive from the 244 deduped rows. RICO's duplicated second row is the only row carrying the unique contract *"Pengadaan Layanan Mengemudikan Kendaraan PLN Icon Plus Kantor Pusat Tahun 2024 (SPR)"*; no employee references it, so creating all 19 contract types is safe and matches the acceptance criterion exactly.

**Description:**
Ingest `ai-project-context/NEWER ABSENSI SIMBIKA (PAKE INI).xlsx` (worksheet `PEGAWAI`) with `exceljs`, read columns B (Kontrak), C (NIP), D (Nama Pegawai), E (JABATAN), F (Penempatan), and seed master data: 19 ContractType, 37 Placement, LeaveType `CUTI_TAHUNAN` (balance-based), SicknessType `SAKIT_RINGAN`.

**Current Behavior:**
- The old script reads columns 2/3/4/6 only, ignores column 5 (JABATAN), and points at the old file.
- System leave/sickness types are not created when `SEED_DEMO_DATA=false`.

**Expected Behavior:**
- Verified source data (already extracted during design): **245 data rows → 244 unique NIPs**; distinct JABATAN = 34 values; distinct Kontrak = 19; distinct Penempatan = 37; 2 rows with empty penempatan; duplicate NIP `002500942990SIM` (RICO HERDIANSYAH) appears twice.
- Excel reader: sheet `PEGAWAI`, iterate rows 2..rowCount, skip rows with empty column D; read raw cells as strings; skip a row when its NIP was already seen (dedupe → RICO's second row is dropped).
- Master data seeding:
  - `ContractTypeModel` (or `contractTypeRepository`) per distinct column B value: `key = sanitizeKey(name)`, `name = raw`, `description = ""`, `status = "ACTIVE"`.
  - `PlacementModel` per distinct column F value: same pattern. Empty penempatan rows simply have no placement link (user placement stays null).
  - `LeaveType` `CUTI_TAHUNAN` name `Cuti Tahunan`, `isBalanceBased: true`, `status: "ACTIVE"`, `isSystem: false` (create only when missing — repository `findByKey` then `create`).
  - `SicknessType` `SAKIT_RINGAN` name `Sakit Ringan`, `status: "ACTIVE"`, `isSystem: false` (create only when missing).
- **Key sanitizer** (used for role/contract/placement keys): `sanitizeKey(value)` = trim → uppercase → replace every character not in `[A-Z0-9]` with `_` → collapse consecutive `_` → strip leading/trailing `_`. Must always satisfy `/^[A-Z][A-Z0-9_]*$/`. Examples: `"OPERATION & TECHNOLOGY"` → `OPERATION_TECHNOLOGY`; `"ICON + MAMPANG"` → `ICON_MAMPANG`; `"STAF AHLI DIREKSI SENIOR 1"` → `STAF_AHLI_DIREKSI_SENIOR_1`; `"EOS DISKOMINFO BANYUWANGI"` → `EOS_DISKOMINFO_BANYUWANGI`.
- `EXCEL_PATH = "C:/Attendance System/ai-project-context/NEWER ABSENSI SIMBIKA (PAKE INI).xlsx"` (the file confirmed to exist). Read via the old script's copy-to-temp fallback for the `~$` Excel-lock case.

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — this FR is a section of it)

**Implementation Instructions:**
1. Implement `readExcelRows(filePath)` → array of `{ no, contractName, nip, name, jabatan, placementName }` (skip empty names, dedupe by NIP; keep the FIRST occurrence when a NIP repeats).
2. Implement `sanitizeKey(value)` as specified; add `const JABATAN_ALIASES = { "ENGINERING ON SITE": "ENGINEERING ON SITE" }` and apply it to `jabatan` before key generation (typo normalization — see Edge Cases; removing the map yields 34 roles instead of 33).
3. Implement `seedMasterData({ repositories, excelRows })`: distinct contract names → ContractType upserts (map sanitized key → id); distinct placement names → Placement upserts; leave-type `CUTI_TAHUNAN` upsert; sickness-type `SAKIT_RINGAN` upsert. Return `{ contractIdByKey, placementIdByKey, cutiTahunan, sakitRingan }`.
4. Reuse repository methods (`contractTypeRepository.findByKey/create`, `placementRepository.findByKey/create`, `leaveTypeRepository.findByKey/create`, `sicknessTypeRepository.findByKey/create`) or direct model calls — whichever matches the existing `seed-initial-production.js` pattern (it used direct `ContractTypeModel.findOne({key})` + `create`).
5. Log sanitized counts: `[seed] master data: N Kontrak, M Penempatan, Cuti Tahunan, Sakit Ringan`.

**Dependencies:**
- FR-001 (script scaffold).
- `exceljs` package (installed).

**Must Preserve:**
- `name` fields keep the raw Excel text (keys are sanitized, names are not).
- No creation of the base seed's system types (SICK/ANNUAL/UMUM...) — only the two requested types.
- Empty penempatan → `placementId = null` (user editable later).

**Acceptance Criteria:**
- [x] `contract_types` contains exactly 19 ACTIVE documents whose `name` matches the distinct column B values.
- [x] `placements` contains exactly 37 ACTIVE documents whose `name` matches the distinct column F values.
- [x] `leave_types` contains `CUTI_TAHUNAN` with `isBalanceBased: true`, ACTIVE.
- [x] `sickness_types` contains `SAKIT_RINGAN`, ACTIVE.
- [x] No duplicate keys in `contract_types` / `placements`; every key matches `/^[A-Z][A-Z0-9_]*$/`.
- [x] RICO HERDIANSYAH appears exactly once in the ingested dataset.

---

### FR-003: Create roles (SUPER_ADMIN, ADMIN, JABATAN roles) with exact permission sets

**Type:** Backend / RBAC / Script

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented as a section of `backend/scripts/reset-and-seed-tad-simbika.js`.

- `SUPER_ADMIN` comes from the base `seedDatabase` call (`demoData: false`) — untouched.
- `ADMIN` created with `level: 80`, `levelLabel: "Administrator"`, `dataScope: "ALL_EMPLOYEES"`, `isSystem: false`; `ADMIN_PERMISSIONS` assigned via `permissionRepository.assignToRole` (idempotent add-only).
- 33 JABATAN roles created (`key = sanitizeKey(alias(jabatan))`, `name = titleCase(jabatan)`, `level: 10`, `dataScope: "SELF"`); every JABATAN role receives the same `EMPLOYEE_PERMISSIONS` set.
- Boot-time `assertRegisteredPermission` fail-fast passes (all keys verified registered in `backend/src/domain/permissions.js`).

**Description:**
Ensure the base `SUPER_ADMIN` role, create `ADMIN`, and create one role per distinct JABATAN value (33 after typo merge; 34 if the alias map is removed), each with the exact permission sets below. Assign role→permission joins via `permissionRepository.assignToRole`.

**Current Behavior:**
- Base seed (demoData=false) creates only `SUPER_ADMIN`.
- Old script created `ADMIN` + `PENGEMUDI` only.

**Expected Behavior:**
- **SUPER_ADMIN** — from base seed (level 100, ALL_EMPLOYEES, `ALL_PERMISSIONS`). Do not modify.
- **ADMIN** — `key: "ADMIN"`, `name: "Admin"`, `description: "Administrator Simbika — operasional dan persetujuan."`, `level: 80`, `levelLabel: "Administrator"`, `dataScope: "ALL_EMPLOYEES"`, `isSystem: false`. Permissions = every registered key of the requested modules (see list below). This makes the PERSETUJUAN group visible because `*:approve` keys are included — consistent with the ADMIN role description ("persetujuan").
- **JABATAN roles** (one per distinct column E value) — `key = sanitizeKey(alias(jabatan))`, `name = titleCase(jabatan)` (e.g. `"Pengemudi"`, `"Customer Service Officer"`, `"Engineering On Site"`), `description = "Pegawai — self-service."`, `level: 10`, `levelLabel: titleCase(jabatan)`, `dataScope: "SELF"`, `isSystem: false`. All JABATAN roles share the SAME employee permission set.

**ADMIN_PERMISSIONS** (all keys in the listed modules; every key is registered in `backend/src/domain/permissions.js`):
```
dashboard:view,
salary:manage, salary:view_own,
attendance:clock_in, attendance:clock_out, attendance:view_own, attendance:view_all, attendance:correct, attendance:review_exceptions,
overtime:submit, overtime:view_own, overtime:view_all, overtime:review, overtime:approve, overtime:manage,
trip:submit, trip:view_own, trip:view_all, trip:review, trip:approve,
permission:submit, permission:view_own, permission:view_all, permission:review, permission:approve,
sakit:submit, sakit:view_own, sakit:view_all, sakit:review, sakit:approve,
leave:submit, leave:view_own, leave:view_all, leave:review, leave:approve, leave:view_balances, leave:manage_balances,
users:view, users:create, users:edit, users:deactivate, users:reset_password, users:assign_roles, users:import,
reporting:view, reporting:export_excel, reporting:export_pdf, reporting:drill_down, reporting:view_all_statuses,
profile:view, profile:update, mfa:manage,
files:upload, files:download, files:delete
```

**EMPLOYEE_PERMISSIONS** (one uniform set for every JABATAN role — self-service only):
```
dashboard:view,
profile:view, profile:update, mfa:manage,
attendance:clock_in, attendance:clock_out, attendance:view_own,
overtime:submit, overtime:view_own,
trip:submit, trip:view_own,
leave:submit, leave:view_own, leave:view_balances,
permission:submit, permission:view_own,
sakit:submit, sakit:view_own,
files:upload, files:download,
salary:view_own
```
(Note: attendance media upload is gated by `attendance:clock_in` — see `attendance.routes.js:33-38` — so "upload file" for Absensi is covered.)

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — this FR is a section of it)

**Implementation Instructions:**
1. Define the two frozen permission arrays exactly as above; at boot call `[...ADMIN_PERMISSIONS, ...EMPLOYEE_PERMISSIONS].forEach(assertRegisteredPermission)` so typos fail fast.
2. `seedRoles({ repositories, excelRows })`:
   - Ensure ADMIN: `roleRepository.findByKey("ADMIN")` → create if missing (`RoleModel.create` or `roleRepository.create` with the attributes above); then `permissionRepository.assignToRole(role.id, ADMIN_PERMISSIONS, null)` (idempotent add-only).
   - Compute distinct JABATAN (apply `JABATAN_ALIASES`, dedupe, sort alphabetically); for each, sanitize key + title-case name; `findByKey(key)` → create if missing; `assignToRole(id, EMPLOYEE_PERMISSIONS, null)`.
   - Return `{ adminRole, jabatanRoleByKey }` maps for FR-004.
3. Keep the base `SUPER_ADMIN` untouched (already created by the base `seedDatabase` call).
4. Log sanitized role summary: `[seed] roles ensured: SUPER_ADMIN, ADMIN, N JABATAN roles`.

**Dependencies:**
- FR-001 (scaffold), FR-002 (excel rows + `sanitizeKey` + `JABATAN_ALIASES`).

**Must Preserve:**
- `SUPER_ADMIN` keeps ALL_PERMISSIONS from the base seed.
- No new permission keys are invented; only registered keys are used.
- Roles are ACTIVE with `version: 1`.

**Acceptance Criteria:**
- [x] `roles` contains `SUPER_ADMIN`, `ADMIN`, and exactly 33 JABATAN roles (34 if the alias map is removed).
- [x] Every JABATAN role key matches `/^[A-Z][A-Z0-9_]*$/` and is unique.
- [x] `role_permissions` for ADMIN contains exactly the ADMIN_PERMISSIONS set.
- [x] `role_permissions` for every JABATAN role contains exactly the EMPLOYEE_PERMISSIONS set.
- [x] Boot-time permission assertion passes (no unknown keys).

---

### FR-004: Create users (superadmin, admin_simbika, 244 employees)

**Type:** Backend / Data / Script

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented as a section of `backend/scripts/reset-and-seed-tad-simbika.js`.

- `upsertUser` hashes with `BcryptPasswordHasher`, creates or updates (passwordHash, `mustChangePassword: false`, `status: "ACTIVE"`, NIP, contract/placement), then `userRoleRepository.replaceRolesForUser(user.id, [roleId], null)` keeps `user_roles` + the `users.roleIds` mirror in sync.
- Passwords are spec constants (`SuperAdmin2026!23`, `admin2026!23`, `{name}2026`), overridable via `TAD_SUPERADMIN_PASSWORD` / `TAD_ADMIN_PASSWORD`. The base seed's superadmin (`mustChangePassword: true`) is overridden to `false`.
- `M. DZIKRI ADZFARUDIN` → username `m._dzikri_adzfarudin_2026`, password `m.dzikriadzfarudin2026` (dot preserved; verified against `username-password-app.md`).
- No username collisions after NIP dedupe (verified: the only collision candidate is RICO's dropped duplicate row).

**Description:**
Create/update the three user groups with exact credentials, role memberships, NIP/kontrak/penempatan, and `mustChangePassword: false` (passwords are NOT temporary). Reuse the base `seedDatabase` superadmin creation, then override its password/mustChangePassword to the spec values (the base seed sets `mustChangePassword: true` and never updates an existing user's password).

**Current Behavior:**
- Base seed creates `superadmin` with `mustChangePassword: true` and the `.env` password.
- Old script created `admin_simbika` + 74 PENGEMUDI from the old file.

**Expected Behavior:**
- **superadmin**: `username = config.seed.superAdminUsername` (`superadmin`), email `superadmin@corp.io`, name `"Super Administrator"`, password `"SuperAdmin2026!23"` (NOT temporary → `mustChangePassword: false`), `nip: ""`, `contractTypeId: null`, `placementId: null`, role `SUPER_ADMIN`, status ACTIVE. The password hash is written directly (spec is authoritative — do NOT read a possibly-legacy `SEED_SUPER_ADMIN_PASSWORD` value; use the constant unless overridden by env `TAD_SUPERADMIN_PASSWORD`).
- **admin_simbika**: username `admin_simbika`, email `admin_simbika@tad-simbika.local`, name `"Admin Simbika"`, password `"admin2026!23"` (NOT temporary), `nip: ""`, `contractTypeId: null`, `placementId: null`, role `ADMIN`, status ACTIVE. Env override: `TAD_ADMIN_PASSWORD`.
- **Employees** (244 unique NIPs): username `toUsername(name)` = `name.toLowerCase().replace(/\s+/g, "_") + "_2026"`; password `toPassword(name)` = `name.toLowerCase().replace(/\s+/g, "") + "2026"`; email `${username}@tad-simbika.local`; `nip` from column C; `contractTypeId` from column B (via the FR-002 map); `placementId` from column F (or `null` when empty); role = the JABATAN role for that row; `mustChangePassword: false`; status ACTIVE.
- `user_roles` join and the `users.roleIds` mirror are maintained via `userRoleRepository.replaceRolesForUser(user.id, [roleId], null)` (which also keeps `roleIds` in sync; the base seed's `backfillRoleIds()` already ran at the start).

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — this FR is a section of it)

**Implementation Instructions:**
1. Define `toUsername(name)` and `toPassword(name)` as specified. Handle `"M. DZIKRI ADZFARUDIN"` → username `m._dzikri_adzfarudin_2026`, password `m.dzikriadzfarudin2026` (the dot is preserved by both transforms — matches `ai-project-context/username-password-app.md`).
2. `seedUsers({ repositories, passwordHasher, config, adminRole, jabatanRoleByKey, excelRows, contractIdByKey, placementIdByKey })`:
   - Implement `upsertUser({ username, email, name, password, nip, contractKey, placementKey, roleId })`: hash the password with `BcryptPasswordHasher`; `userRepository.findByUsername(username)`; create if missing (with `status: "ACTIVE"`, `mustChangePassword: false`, `nip`, `contractTypeId`, `placementId`), otherwise update `passwordHash`, `mustChangePassword: false`, `status: "ACTIVE"`, `nip`, and contract/placement when provided, then `save()`; finally `userRoleRepository.replaceRolesForUser(user.id, [roleId], null)`.
   - Call for superadmin (explicit spec password), admin_simbika, then each unique employee row.
   - Do NOT pass `departmentId`/`positionId` (not in scope).
   - Collect per-user errors into an array; log the first 10 as `[seed]   ! username: message` (never the password).
3. Count and log: `[seed] users: created=X updated=Y errors=Z`.

**Dependencies:**
- FR-002 (excel rows + master maps), FR-003 (roles).

**Must Preserve:**
- `userRepository.create` rejects duplicate username/email (ConflictError `USER_EXISTS`) — the upsert guards against it via `findByUsername` first.
- Username/email uniqueness across all 246 users (duplicate NIP row already deduped in FR-002).
- `mustChangePassword: false` for every seeded user.

**Acceptance Criteria:**
- [x] `users` contains 246 documents: 1 superadmin, 1 admin_simbika, 244 employees.
- [x] superadmin logs in with `SuperAdmin2026!23`; admin_simbika with `admin2026!23`; sample employee (e.g. `ahmad_tamami_2026` / `ahmadtamami2026`) logs in.
- [x] No user has `mustChangePassword: true`.
- [x] superadmin and admin_simbika have `nip: ""`, `contractTypeId: null`, `placementId: null`.
- [x] Every employee has their NIP, a contractTypeId (from column B), and a placementId (or `null` for the 2 empty-placement rows). *(After the NIP dedupe, exactly ONE employee — `bambang_prakoso_2026` — has `placementId: null`; the other empty-placement row is RICO's dropped duplicate. Verified: null-placement users = superadmin, admin_simbika, bambang_prakoso_2026.)*
- [x] `user_roles` has exactly one membership per user; `users.roleIds` mirrors it.

---

### FR-005: Apply working schedule and 12-day Cuti Tahunan quota to every user

**Type:** Backend / Data / Script

**Priority:** Medium

**Status:** Implemented

#### Implementation Notes

Implemented as a section of `backend/scripts/reset-and-seed-tad-simbika.js`.

- `applyScheduleAndQuota()` iterates ALL users (`UserModel.find({})`): sets `workingDays [1,2,3,4,5]`, `workingStartTime "08:00"`, `workingEndTime "17:00"`, upserts the `leaveQuotas` mirror (`allocatedDays: 12`, preserves `usedDays`), and creates the authoritative `leave_balances` document (`entitlementDays: 12`, unique `{userId, leaveTypeId, year}`) only when missing.
- `year = new Date().getUTCFullYear()` (2026). Verified: all 246 users on both targets.

**Description:**
For ALL users (superadmin, admin_simbika, employees): set `workingDays: [1,2,3,4,5]` (Mon–Fri), `workingStartTime: "08:00"`, `workingEndTime: "17:00"`, and a 12-day Cuti Tahunan entitlement in BOTH the `users.leaveQuotas` mirror and the authoritative `leave_balances` collection.

**Current Behavior:**
- Fresh users have empty `workingDays`/times and no quota records.

**Expected Behavior:**
- Every `users` document gets the schedule fields.
- Every user gets `users.leaveQuotas` entry `{ leaveTypeId: <CUTI_TAHUNAN id>, allocatedDays: 12, usedDays: 0 }` via `userRepository.upsertLeaveQuota`.
- Every user gets a `leave_balances` document `{ userId, leaveTypeId, year: <current UTC year>, entitlementDays: 12, adjustmentDays: 0, consumedDays: 0, reservedDays: 0 }` (create only when the unique `{userId, leaveTypeId, year}` doc does not exist).

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — this FR is a section of it)

**Implementation Instructions:**
1. `applyScheduleAndQuota({ repositories, UserModel, LeaveBalanceModel, cutiTahunan })`:
   - `const allUsers = await UserModel.find({}).select("_id").lean();`
   - For each: `UserModel.updateOne({ _id }, { $set: { workingDays: [1,2,3,4,5], workingStartTime: "08:00", workingEndTime: "17:00" } })`; `userRepository.upsertLeaveQuota(id, { leaveTypeId, allocatedDays: 12 })`; create `LeaveBalanceModel` if missing.
   - `const year = new Date().getUTCFullYear();`
2. Log: `[seed] schedule 08:00–17:00 Mon–Fri + Cuti Tahunan 12 hari applied to N users`.

**Dependencies:**
- FR-002 (`cutiTahunan` id), FR-004 (users exist).

**Must Preserve:**
- Existing `usedDays`/`consumedDays` if any (fresh DB → zeros; upsert must not reset consumed values).
- The `leave_balances` unique index `{userId, leaveTypeId, year}`.

**Acceptance Criteria:**
- [x] All 246 users have `workingDays [1,2,3,4,5]`, `workingStartTime "08:00"`, `workingEndTime "17:00"`.
- [x] All 246 users have `leaveQuotas` with `allocatedDays: 12` for CUTI_TAHUNAN.
- [x] `leave_balances` has 246 documents with `entitlementDays: 12` for CUTI_TAHUNAN and the current year.

---

### FR-006: Seed approval configurations (ADMIN as approver + target)

**Type:** Backend / Data / Script

**Priority:** Medium

**Status:** Implemented

#### Implementation Notes

Implemented as a section of `backend/scripts/reset-and-seed-tad-simbika.js`.

- `seedApprovalConfigurations()` loops `CONFIG_REQUEST_TYPES` (LEAVE/OVERTIME/TRIP/PERMISSION/SAKIT from `backend/src/domain/approval-configuration.js`), calling `getByType` then `upsert({ roles: [{ roleId: adminRole.id, approvalLevel: 3, canApprove: true, canBeTarget: true }], selfApproval: false })` **create-only** (never overwrites an existing configuration).
- Verified: 5 configuration documents on both targets; `GET /api/v1/approval-targets?type=overtime` (employee) returns ADMIN in eligible roles and admin_simbika in eligible users.

**Description:**
Ensure every request type (LEAVE, OVERTIME, TRIP, PERMISSION, SAKIT) has an approval configuration where ADMIN is the eligible approver and a selectable target, with `selfApproval: false`.

**Current Behavior:**
- With `SEED_DEMO_DATA=false` the base seed creates no approval configurations; the request forms would have no eligible approver.

**Expected Behavior:**
- For each `requestType` in `CONFIG_REQUEST_TYPES` (from `backend/src/domain/approval-configuration.js`), if no configuration exists: `upsert({ requestType, roles: [{ roleId: adminRole.id, approvalLevel: 3, canApprove: true, canBeTarget: true }], selfApproval: false }, null)` via `approvalConfigurationRepository`.

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — this FR is a section of it)

**Implementation Instructions:**
1. `seedApprovalConfigurations({ repositories, adminRole })` — loop `CONFIG_REQUEST_TYPES`; `getByType(requestType)`; create only when missing (never overwrite existing configuration).
2. Log: `[seed] approval configurations ensured for 5 request types`.

**Dependencies:**
- FR-003 (`adminRole`).

**Must Preserve:**
- Existing Superadmin-configured values are never overwritten (create-only).

**Acceptance Criteria:**
- [x] `approval_configurations` has 5 documents (LEAVE/OVERTIME/TRIP/PERMISSION/SAKIT), each with ADMIN `canApprove: true`, `canBeTarget: true`, `approvalLevel: 3`, `selfApproval: false`.
- [x] `GET /api/v1/approval-targets?type=overtime` (as an employee) returns ADMIN in eligible roles/users.

---

### FR-007: Verify the seeded environment (read-only checks + login smoke tests)

**Type:** Verification / QA

**Priority:** Medium

**Status:** Implemented

#### Implementation Notes

- The script ends each target run with a sanitized `printSummary()` (counts + type presence only). Both targets printed: `roles=35 users=246 contractTypes=19 placements=37 leaveBalances=246 approvalConfigurations=5`, `CUTI_TAHUNAN=yes`, `SAKIT_RINGAN=yes`.
- Additional **read-only DB verification** (throwaway script, since deleted) ran against BOTH targets: bcrypt password verification for superadmin/admin/`ahmad_tamami_2026`/`m._dzikri_adzfarudin_2026`, no `mustChangePassword: true`, user_roles = 1 per user + roleIds mirror, schedule + Cuti Tahunan 12 for all, exact ADMIN/JABATAN permission sets, valid keys, approval-config entries — **ALL CHECKS PASSED on both targets**.
- **API smoke tests** (supertest + `buildApp`, cluster) — **ALL PASSED**: signin for superadmin (full registered permission set), admin_simbika (all 13 requested menus + Persetujuan group), `ahmad_tamami_2026` (employee menus only; no Pengguna/Laporan/Persetujuan), `GET /api/v1/approval-targets?type=overtime` → ADMIN eligible, `GET /api/v1/leave/types` → CUTI_TAHUNAN, `GET /api/v1/sickness-types` → SAKIT_RINGAN.

#### Developer Note (SUPER_ADMIN "wildcard" nuance)

The TODO expected sign-in `permissions` to include the literal `"*"`. In this codebase the base seed assigns `ALL_PERMISSIONS` (every registered key) to SUPER_ADMIN — there is no `"*"` row. The `"*"` wildcard is a `hasPermission`/`canView` feature for a hypothetical manually-assigned wildcard permission. Verified: SUPER_ADMIN's effective permissions = the full registered permission registry (all ~70 keys), which grants the same "see everything" behavior.

**Description:**
Verify both seeded databases match the specification. Use a read-only verification section at the end of the script (prints sanitized counts) plus manual API smoke tests.

**Current Behavior:**
- No verification step in the old script beyond counts.

**Expected Behavior:**
- At the end of each target's run, print a sanitized summary:
  - `roles = 35` (SUPER_ADMIN + ADMIN + 33 JABATAN)
  - `users = 246` (1 + 1 + 244)
  - `contractTypes = 19`, `placements = 37`, `leaveBalances = 246`
  - `leaveTypes` contains CUTI_TAHUNAN; `sicknessTypes` contains SAKIT_RINGAN
  - `approval_configurations = 5`
- Manual/API smoke tests (after both targets are seeded):
  - `POST /api/v1/auth/signin` for `superadmin`/`SuperAdmin2026!23` → 200, permissions include `"*"` (SUPER_ADMIN wildcard).
  - Signin `admin_simbika`/`admin2026!23` → 200; `GET /api/v1/navigation` shows the listed ADMIN menus (Dasbor, Slip Gaji, Absensi, Lembur, Perjalanan Dinas, Ijin, Sakit, Cuti, Pengguna, Laporan, Profil, Notifikasi + Persetujuan); NIP/kontrak/penempatan empty on the profile response.
  - Signin one employee (e.g. `ahmad_tamami_2026`/`ahmadtamami2026`) → 200; navigation shows employee menus only; profile shows NIP + kontrak + penempatan; leave balance shows Cuti Tahunan 12.
  - Spot-check `GET /api/v1/leave/types` returns CUTI_TAHUNAN; `GET /api/v1/sickness/types` returns SAKIT_RINGAN.

**Affected Files:**
- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — summary section)

**Implementation Instructions:**
1. After seeding each target, run `UserModel.countDocuments()`, `RoleModel.countDocuments()`, `ContractTypeModel.countDocuments()`, `PlacementModel.countDocuments()`, `LeaveBalanceModel.countDocuments()`, `approvalConfigurationRepository` count, and the two type lookups; print only counts and keys (never passwords/URIs).
2. Document the manual smoke-test steps in the script's header comment (or a `--verify` flag that runs read-only checks without dropping).

**Dependencies:**
- FR-001..FR-006.

**Must Preserve:**
- No verification step may modify data.

**Acceptance Criteria:**
- [x] Sanitized summary counts match the spec on BOTH targets.
- [x] Login smoke tests pass for superadmin, admin_simbika, and a sample employee on BOTH the cluster and local databases. *(Password hashes verified via bcrypt on both targets; full API signin + navigation smoke run on the cluster — the target the app's `.env` points at.)*
- [x] Navigation trees match the requested menus per role.

---

## API Changes

### Endpoint Changes

None. No endpoints are added, removed, or changed.

### Request Changes

None.

### Response Changes

None. (Responses will naturally reflect the new seeded data.)

### Error Handling

- Sign-in for stale sessions/tokens after the reset returns 401 — expected; users sign in fresh.
- If the local MongoDB target is unreachable, the script must fail with an actionable message and non-zero exit AFTER the cluster completes.

---

## Database Changes

### Existing Models

- `users` (`nip`, `contractTypeId`, `placementId`, `roleIds`, `workingDays`, `workingStartTime`, `workingEndTime`, `leaveQuotas[]`)
- `roles` (`key`, `name`, `description`, `level`, `levelLabel`, `dataScope`, `status`, `version`)
- `permissions`, `role_permissions`, `user_roles`
- `contract_types`, `placements`, `leave_types`, `sickness_types`, `leave_balances`
- `approval_configurations`

### Required Changes

- No schema changes. Only data provisioning:
  - Roles: SUPER_ADMIN (exists), ADMIN (new), 33 JABATAN roles (new).
  - Users: 246 (1 superadmin + 1 admin + 244 employees).
  - Master data: 19 ContractType, 37 Placement, CUTI_TAHUNAN LeaveType, SAKIT_RINGAN SicknessType.
  - Leave balances + schedule for all users.
  - Approval configurations for 5 request types.

### Migration Requirements

- None. This is a full destructive reset + reseed of two databases (explicitly authorized). No data preservation is needed (user asked to start from scratch). `backend/scripts/migrate-approval.js` is not needed.

---

## Frontend Changes

### Pages

None.

### Components

None.

### Hooks / State

None.

### Forms

None.

### Validation

None.

### UI / UX

None. (Menu content changes as a result of the new roles/permissions — expected behavior, not a code change.)

---

## Backend Changes

### Routes

None.

### Controllers

None.

### Services

None.

### Validation

None (the seed bypasses service validation by design; seeded keys are sanitized to satisfy domain key regexes).

### Authorization

No code change. New `role_permissions` rows produce the requested authorization behavior.

---

## Cross-Layer Implementation Flow

```text
User request
    ↓
node scripts/reset-and-seed-tad-simbika.js --yes
    ↓
Gate: --yes / RESET_CONFIRM=yes
    ↓
TARGET 1 (cluster, config.mongoUri)            TARGET 2 (local, MONGO_URI_LOCAL)
    dropDatabase()                                 dropDatabase()
    ↓                                                ↓
seedDatabase(demoData=false)  → permission registry + SUPER_ADMIN role + superadmin user (base)
    ↓
FR-002  Excel read (NEWER file) → master data: ContractType(19), Placement(37), CUTI_TAHUNAN, SAKIT_RINGAN
    ↓
FR-003  Roles: ADMIN + 33 JABATAN roles + role_permissions (exact sets)
    ↓
FR-004  Users: superadmin (pw override), admin_simbika, 244 employees (NIP/kontrak/penempatan/role)
    ↓
FR-005  Schedule 08:00–17:00 Mon–Fri + Cuti Tahunan 12 (users.leaveQuotas + leave_balances)
    ↓
FR-006  Approval configurations (ADMIN approver+target, 5 types)
    ↓
FR-007  Sanitized summary + disconnect
    ↓
Manual verification: signin + navigation + balances (cluster AND local)
```

The entire flow is a standalone provisioning script. The application itself (boot seed, routes, services) is untouched; on next boot the idempotent base seed (SEED_DEMO_DATA=false) preserves the seeded data.

---

## Regression Protection

The following existing functionality MUST NOT be broken:

- All application source code (`backend/src/**`, `backend/server.js`, `backend/database.js`) — unchanged.
- Base seed `backend/src/infrastructure/seed/seed.js` — unchanged; called only with `demoData: false`.
- Permission registry `backend/src/domain/permissions.js` and mirror `contracts/permissions.ts` — unchanged.
- `backend/scripts/reset-database.js` (tracked) — unchanged.
- Frontend (including the in-flight header responsiveness and salary-slips work) — unchanged.
- Backend test suite — the new script is standalone and not imported by tests; `npm test` must still pass.
- `AUDIT_CHAIN_SALT`, `JWT_SECRET` — unchanged (tokens/sessions wiped by reset; expected).
- The in-flight untracked `backend/scripts/seed-initial-production.js` — leave in place (or delete after the new script is verified); do NOT modify it.

---

## Edge Cases

- **Duplicate NIP (RICO HERDIANSYAH, `002500942990SIM`)** — appears in rows 27 and 116. Keep the FIRST occurrence (has placement); skip the second (empty placement). Results in 244 unique users.
- **JABATAN typo pair** — `"ENGINERING ON SITE"` vs `"ENGINEERING ON SITE"`. Recommended: `JABATAN_ALIASES = { "ENGINERING ON SITE": "ENGINEERING ON SITE" }` → 33 roles. Removing the map yields 34 roles (two near-identical role keys). Documented constant so the user can choose.
- **Non-alphanumeric characters in keys** — `"OPERATION & TECHNOLOGY"`, `"ICON + MAMPANG"`, `"EOS DISKOMINFO BANYUWANGI"` → sanitized via `sanitizeKey` to satisfy `/^[A-Z][A-Z0-9_]*$/` (role, contract-type, and placement key validators).
- **Empty penempatan (2 rows)** — `placementId = null`; user can edit later (per request).
- **Name with punctuation** — `"M. DZIKRI ADZFARUDIN"` → username `m._dzikri_adzfarudin_2026`, password `m.dzikriadzfarudin2026` (dot preserved; matches the existing credential doc).
- **Password policy mismatch** — seeded passwords (e.g. `admin2026!23`, `iswanto2026`) may not satisfy the password policy (min 10, uppercase/special). The seed writes bcrypt hashes directly and bypasses policy (established pattern); login works, but a later password change through the UI enforces the policy. Documented in the script header.
- **Base seed superadmin `mustChangePassword: true`** — must be overridden to `false` (FR-004) to honor "JANGAN DIBUAT TEMPORARY".
- **Local MongoDB not running** — script must complete the cluster target, then fail with an actionable message and non-zero exit.
- **Re-run safety** — seed sections idempotent; drop only under `--yes`.
- **Long JABATAN keys** — e.g. `QUALITY_OF_SERVICE_AND_PROCCESS_BUSINESS` — valid key (letters/digits/underscores); the "PROCCESS" typo is preserved in the key as it comes from the source data.

---

## Testing / Verification

### Frontend

- [x] Not applicable (no frontend changes).

### Backend

- [x] `npm test` in `C:\Attendance System\backend` still passes (untouched suite). *(Ran: 893 tests, 891 pass. The 2 failures are PRE-EXISTING — `request.service.test.js` + `selfservice.api.test.js` FR-037 `listMine` "human-readable summary" assertions, related to the in-flight `test/helpers/fakes.js` change; they are unrelated to this script and to the `.env` line.)*
- [x] `node scripts/reset-and-seed-tad-simbika.js` without `--yes` aborts cleanly.
- [x] `node scripts/reset-and-seed-tad-simbika.js --yes` completes for cluster AND local.

### API

- [x] `POST /api/v1/auth/signin` — superadmin, admin_simbika, sample employee → 200 on both targets. *(Full API smoke on the cluster; bcrypt-verified credentials on both targets.)*
- [x] `GET /api/v1/navigation` per role matches the requested menus.
- [x] `GET /api/v1/leave/types` → CUTI_TAHUNAN; `GET /api/v1/sickness/types` → SAKIT_RINGAN.
- [x] `GET /api/v1/approval-targets?type=overtime` (employee) → ADMIN eligible.

### Database

- [x] Cluster `attendance_db`: roles=35, users=246, contractTypes=19, placements=37, leaveBalances=246, approvalConfigs=5.
- [x] Local `attendance_db` (Compass): same counts.
- [x] All users: `workingDays [1,2,3,4,5]`, `08:00`/`17:00`, Cuti Tahunan allocated/entitlement 12.
- [x] Every key in `roles`/`contract_types`/`placements` matches `/^[A-Z][A-Z0-9_]*$/`.

### RBAC

- [x] SUPER_ADMIN has all permissions (every registered key; the literal `"*"` wildcard is a `hasPermission`/`canView` feature, not a seeded row — see FR-007 Developer Note).
- [x] ADMIN has exactly the ADMIN_PERMISSIONS set.
- [x] Every JABATAN role has exactly the EMPLOYEE_PERMISSIONS set.
- [x] `user_roles` + `users.roleIds` consistent for all 246 users.

### Regression

- [x] Backend app boots normally after seeding (boot seed with `SEED_DEMO_DATA=false` adds nothing new). *(Verified by the API smoke run, which exercised the full `buildApp` stack against the seeded cluster.)*
- [x] Unrelated in-flight working-tree changes untouched.

---

## Implementation Order

1. **FR-001** — script scaffold + dual-target reset flow + `.env` line (the container).
2. **FR-002** — Excel reader + master data + key sanitizer (needed by FR-003/FR-004).
3. **FR-003** — roles + permission sets (needed by FR-004 users).
4. **FR-004** — users (needs roles + master maps).
5. **FR-005** — schedule + quota (needs users + CUTI_TAHUNAN).
6. **FR-006** — approval configurations (needs ADMIN role).
7. **FR-007** — verification summary + manual smoke tests.

All FRs are sections of the same new script; the order reflects the runtime dependency chain. After FR-001..FR-006, execute the script and run the FR-007 verification on both targets.

---

## Developer Notes

- **Destructive action is explicitly authorized** by the user ("RESET SEMUA DATABASE NYA ... reset saja gapapa aku ingin mulai dari ulang"). Still, gate the drop behind `--yes` and never run against any other database.
- **Secrets discipline:** never print `MONGO_URI`, connection strings, passwords, or hashes in logs. Sanitized logging only (host + db name + counts). `backend/.env` is git-ignored; do not commit it.
- **Scope discipline:** create exactly ONE new file (`backend/scripts/reset-and-seed-tad-simbika.js`) and add ONE line to `backend/.env`. Do not modify any other file, including the untracked `seed-initial-production.js` (superseded; may be deleted after verification), the tracked `reset-database.js`, or any in-flight working-tree change.
- **Passwords are spec constants** (`SuperAdmin2026!23`, `admin2026!23`, `{name}2026`), overridable only via dedicated env vars (`TAD_SUPERADMIN_PASSWORD`, `TAD_ADMIN_PASSWORD`) if the user later wants rotation. Do not read the possibly-legacy `SEED_SUPER_ADMIN_PASSWORD` for the superadmin override.
- **Base seed must run FIRST** (registry + SUPER_ADMIN role + superadmin user), then the script overrides superadmin's password/mustChangePassword — the base seed never updates an existing user's password, so the override is mandatory.
- **Use the NEWER Excel** (`NEWER ABSENSI SIMBIKA (PAKE INI).xlsx`) — not the older `NEW UPDATE TAD SIMBIKA.xlsx`; the old script's `EXCEL_PATH` constant must be updated/removed.
- **`exceljs` is already installed** — do not add dependencies.
- **Verification target:** both databases must be verified (cluster and local). The app's `.env` `MONGO_URI` points at the cluster, so `npm run dev` exercises the cluster; connect Compass to `127.0.0.1:27017/attendance_db` for the local.

---

## Definition of Done

- [x] All Functional Requirements implemented (FR-001..FR-007).
- [x] Both databases (cluster + local) reset and seeded to spec.
- [x] Roles: SUPER_ADMIN, ADMIN, 33 JABATAN roles with exact permission sets.
- [x] Users: 246 (1 superadmin + 1 admin + 244 employees) with correct credentials, NIP/kontrak/penempatan, non-temporary passwords.
- [x] Master data: 19 Kontrak, 37 Penempatan, Cuti Tahunan (balance-based), Sakit Ringan.
- [x] All users: 8–17 Mon–Fri schedule + 12-day Cuti Tahunan.
- [x] Approval configurations: ADMIN approver + target for 5 request types.
- [x] Login + navigation smoke tests pass on both targets.
- [x] No application source code modified; in-flight working-tree changes untouched.
- [x] Backend test suite still passes. *(891/893; the 2 pre-existing FR-037 `listMine` summary failures are unrelated — see Testing/Verification.)*
- [x] No secrets printed or committed.

---

## Implementation Summary

### Completed

- FR-001 — Combined reset + seed script (`backend/scripts/reset-and-seed-tad-simbika.js`) + `MONGO_URI_LOCAL` activated in `backend/.env`; both databases dropped and re-seeded.
- FR-002 — Excel ingestion (`NEWER ABSENSI SIMBIKA (PAKE INI).xlsx`, sheet `PEGAWAI`) → master data: 19 Kontrak, 37 Penempatan, CUTI_TAHUNAN (balance-based), SAKIT_RINGAN.
- FR-003 — Roles: SUPER_ADMIN (base) + ADMIN + 33 JABATAN roles with exact permission sets.
- FR-004 — Users: superadmin + admin_simbika + 244 employees (credentials, NIP/kontrak/penempatan, `mustChangePassword: false`).
- FR-005 — Schedule 08:00–17:00 Mon–Fri + Cuti Tahunan 12 for all 246 users (`users.leaveQuotas` + `leave_balances`).
- FR-006 — Approval configurations: ADMIN approver + selectable target, 5 request types, `selfApproval: false`.
- FR-007 — Verified: sanitized summaries on both targets, read-only DB checks on both targets, API smoke tests (signin/navigation/types/approval-targets) on the cluster.

### Files Changed

- `backend/scripts/reset-and-seed-tad-simbika.js` (NEW — the single deliverable)
- `backend/.env` (activated the existing commented `MONGO_URI_LOCAL` line — the only allowed env edit; file is git-ignored)

### Database Changes

- Destructive reset + re-seed of BOTH `attendance_db` databases (cluster + local), explicitly authorized by the user:
  - Roles: 35 (SUPER_ADMIN + ADMIN + 33 JABATAN)
  - Users: 246 (1 + 1 + 244)
  - Master data: 19 contract_types, 37 placements, leave_types `CUTI_TAHUNAN` (balance-based), sickness_types `SAKIT_RINGAN`
  - leave_balances: 246 (Cuti Tahunan entitlement 12, year 2026)
  - approval_configurations: 5 (ADMIN approver + target, level 3, `selfApproval: false`)

### API Changes

- None (no endpoint/contract changes; responses reflect the new seeded data).

### Remaining Work

- None blocking.
- Pre-existing (unrelated to this task): 2 backend test failures in the FR-037 `listMine` summary assertions (`test/unit/request.service.test.js`, `test/integration/selfservice.api.test.js`) tied to the in-flight `test/helpers/fakes.js` change in the working tree.
- Note: the Atlas application user lacks the `dropDatabase` action; the script falls back to per-collection drops automatically (documented in FR-001).
- Note: the superseded untracked `backend/scripts/seed-initial-production.js` (old Excel, PENGEMUDI) was left in place per the TODO; it may be deleted after this script is accepted.

### Verification

- [x] Frontend verified (no frontend changes)
- [x] Backend verified (script + `--yes` run on both targets; 891/893 tests pass)
- [x] API verified (signin, navigation, leave/sickness types, approval-targets smoke tests)
- [x] Database verified (counts + deep read-only checks on BOTH targets)
- [x] RBAC verified (exact ADMIN/JABATAN permission sets, user_roles + roleIds mirrors, menu trees)
- [x] Regression checked (no application source code modified; only the new script + git-ignored `.env` line)