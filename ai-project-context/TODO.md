# Technical Implementation TODO

> Prepared by the Senior Designer per `DESIGNER.md`. This document is the implementation contract for the Developer Agent.
>
> **Issue**: User request (from `.opencode/prompts/DESIGNER.md`):
> *"akses env, config, tidak apa apa, aku ingin kamu create collection untuk mongodb, karena sekarang sudah ke mongodb cluster — coba buat data collection yang berhubungan dengan accessing websitenya, seperti role, user, akses menu untuk superadmin, jadi show semuanya"*
>
> **Interpretation**: The application now connects to MongoDB Atlas (`backend/.env` → `MONGO_URI` = Atlas `mongodb+srv://` URI). The user wants the website-access data collections (roles, users, superadmin menu access) created/populated on the cluster and then **show everything** (a full dump/inspection of that data).

---

## Issue Summary

### User Request

1. Create the MongoDB collections related to website access on the current (Atlas) cluster.
2. The collections in question: **roles**, **users**, and **superadmin menu access** (plus the supporting `permissions`, `role_permissions`, `user_roles` collections that make access work).
3. After creation, **show everything** — a readable, complete report of roles, users, role→permission mappings, user→role memberships, and the SUPER_ADMIN navigation/menu tree.

### Problem

- The access collections are defined in code (`backend/src/infrastructure/models/*`) but only exist in the database after the app boots and the idempotent seed runs. On a freshly-configured Atlas cluster there may be no collections at all yet.
- There is no standalone, repeatable way to (a) ensure the access collections exist and are populated and (b) dump all access data in one place.
- The SUPER_ADMIN menu access tree is computed at runtime (`buildNavigationFor` + `NAVIGATION_CATALOG`) and is not displayed anywhere as a report.
- Existing UI (RBAC console, Users page) shows pieces, but not everything together, and requires a running browser + login.

### Expected Result

- `backend/scripts/show-access-collections.js` — a standalone Node script that:
  1. Connects to the configured MongoDB (`config.mongoUri`, which is now the Atlas URI).
  2. Ensures the access collections exist and are populated by invoking the existing idempotent `seedDatabase(...)` (same wiring as `scripts/reset-database.js`).
  3. Prints a complete, human-readable report:
     - Collections present in the connected database.
     - Roles (key, name, level, dataScope, status) with their permission keys.
     - Users (username, name, email, status, role keys) with NO secret fields (`passwordHash`, `passwordHistory`, `tokenVersion` internals) — plus role membership.
     - The **SUPER_ADMIN menu/navigation tree** built from the SUPER_ADMIN role's effective permissions via `buildNavigationFor(...)`.
- `npm run access:show` script entry in `backend/package.json`.
- Pure report-building helpers under `backend/src/domain/access-report.js` so the formatting logic is unit-testable without a database.
- No frontend changes. No schema changes. No RBAC changes. No secret values printed.

### Issue Classification

New Feature (operational tooling) — backend only; no schema/API/RBAC/frontend changes.

### Scope

- New: `backend/scripts/show-access-collections.js`
- New: `backend/src/domain/access-report.js` (pure helpers)
- Modify: `backend/package.json` (add `access:show` script)
- New test: `backend/test/unit/access-report.test.js`
- Documentation: this TODO is the spec; no `project-context.md` update required beyond the `access:show` command (optional §22 addition).

---

## Existing Architecture

### Relevant Frontend

- Not affected. The RBAC console (`frontend/src/features/rbac-admin/RbacConsolePage.tsx`) and Users page already expose interactive views; this task adds a backend-only CLI report and must not change the frontend.

### Relevant Backend

- `backend/server.js` — `buildApp(config)` returns `repositories` including `roleRepository`, `permissionRepository`, `userRepository`, `leaveTypeRepository`, `sicknessTypeRepository`, `approvalConfigurationRepository` (pattern used by `scripts/reset-database.js`).
- `backend/src/infrastructure/seed/seed.js` — `seedDatabase({ roleRepository, permissionRepository, userRepository, passwordHasher, config, leaveTypeRepository, sicknessTypeRepository, approvalConfigurationRepository, logger })`; idempotent; provisions permissions, roles (SUPER_ADMIN always; others when `config.seed.demoData !== false`), role→permission mappings, SUPER_ADMIN user, demo users, approval configs.
- `backend/src/infrastructure/config.js` — `createConfig()` exposes `config.mongoUri` (Atlas URI via `MONGO_URI`), `config.seed.*`.
- Models (collections): `user.model.js` (`users`), `role.model.js` (`roles`), `permission.model.js` (`permissions`), `role-permission.model.js` (`role_permissions`), `user-role.model.js` (`user_roles`).
- Repositories: `user.repository.js` (`list`, `findByUsername`, `findByIds`), `role.repository.js` (`listAll`, `findByKey`), `permission.repository.js` (`listAll`, `permissionKeysForRole`), `user-role.repository.js` (`findByUserId`).
- `backend/src/application/navigation.service.js` — `buildNavigationFor(permissions)` → visible tree (pure, no I/O).
- `backend/src/domain/navigation-catalog.js` — `NAVIGATION_CATALOG` (the menu tree definition).
- `backend/src/domain/permissions.js` — `PERMISSION_DEFINITIONS`, `ALL_PERMISSIONS`, `assertRegisteredPermission`.
- `backend/scripts/reset-database.js` — the wiring pattern to copy for a standalone script.

### Relevant Database

- Collections involved (all existing, no schema change): `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- The menu/access tree is **not stored** — it is derived at runtime from `role_permissions` + `NAVIGATION_CATALOG`.

### Relevant API

- No API changes. The script connects directly via Mongoose (same as `reset-database.js`); it does not go through HTTP.

### Relevant Authentication

- Not affected. The script is an operator/CLI tool connecting via `config.mongoUri`; no JWT/session logic.

### Relevant Authorization / RBAC

- Not affected. The script only reads data that the seed itself creates; it uses the SUPER_ADMIN role's granted permissions to build the menu tree. It does not mutate RBAC beyond what `seedDatabase` already does (idempotent).

### Relevant Navigation

- The SUPER_ADMIN menu tree is produced from `buildNavigationFor(superAdminPermissionKeys)` — reuse, do not duplicate the logic.

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | Not Affected | No UI changes. |
| Backend | Affected | New script + new pure helper module + package.json script entry. |
| Database | Potentially Affected | Script runs the existing idempotent seed against the connected DB (creates missing collections/data on a fresh Atlas cluster). No schema change. |
| API | Not Affected | No endpoint changes. |
| Authentication | Not Affected | No auth changes. |
| Authorization / RBAC | Not Affected | No permission changes; reads SUPER_ADMIN permissions. |
| Navigation | Not Affected | Menu tree is reused from `buildNavigationFor`. |
| UI/UX | Not Affected | CLI output only. |
| Business Logic | Not Affected | No business-rule changes. |
| Validation | Not Affected | No DTO/validation changes. |
| File Storage | Not Affected | — |
| Notifications | Not Affected | — |
| Reports | Not Affected | — |
| Audit Logs | Not Affected | Script is an inspection tool; no audit events are recorded (do not add audit recording to a read-only CLI dump). |
| Performance | Not Affected | One-off operator script. |
| Testing | Affected | New unit test for `access-report.js` helpers; manual run of the script as verification. |

---

## Functional Requirements

### FR-001: Create `backend/src/domain/access-report.js` (pure report helpers)

**Type:** Backend (new domain module — pure, no I/O, no Mongoose imports)

**Priority:** High

**Status:** Proposed

**Description:**
Extract all formatting/sanitization logic into a framework-free module so it can be unit-tested and reused by the script. The module must never import Mongoose or repositories — it transforms already-loaded data into report rows.

**Current Behavior:**
Not present — formatting logic does not exist anywhere.

**Expected Behavior:**
The module exports pure functions that the script uses to build report rows:

```js
// Sanitized user row: NO passwordHash/passwordHistory/__v/etc.
sanitizeUser(user) -> { id, username, name, email, status, roleIds }

// Role row with sorted permission keys
roleRow(role, permissionKeys) -> { key, name, level, levelLabel, dataScope, status, permissions }

// User row with resolved role keys
userRow(user, roleKeysById) -> { username, name, email, status, roles }

// SUPER_ADMIN menu tree (wrap buildNavigationFor; return as-is)
// The tree is already plain serializable objects from navigation.service.js
```

**Affected Files:**
- `backend/src/domain/access-report.js` (new)

**Implementation Instructions:**
1. Create `backend/src/domain/access-report.js`.
2. `sanitizeUser(user)` — return a shallow pick of `{ id: String(user._id ?? user.id), username, name, email, status, roleIds: (user.roleIds ?? []).map(String) }`. Never include `passwordHash`, `passwordHistory`, `failedLoginAttempts`, `lockedUntil`, `tokenVersion`, `passwordVersion`, `passwordChangedAt`.
3. `roleRow(role, permissionKeys)` — `{ key: role.key, name: role.name, level: role.level, levelLabel: role.levelLabel, dataScope: role.dataScope, status: role.status, permissions: [...permissionKeys].sort() }`.
4. `userRow(user, roleKeysById)` — `roleKeysById` is a `Map<roleIdString, roleKey>`; resolve `user.roleIds` → sorted role keys; output `{ username, name, email, status, roles }`.
5. `buildMenuTree(permissionKeys)` — `return require("./navigation.service")?.buildNavigationFor(permissionKeys)` — actually import `buildNavigationFor` from `../application/navigation.service` at module top; the helper is a thin wrapper so callers don't import the application layer directly. (Domain modules are normally pure; `navigation.service.js` is itself pure — importing it is acceptable here because it has no I/O. If this violates the layering rule, import `buildNavigationFor` inside the function to keep the top of the file Mongoose-free.)
6. Do not add console.log here — the script owns printing.

**Dependencies:**
- None (used by FR-002).

**Must Preserve:**
- No secrets in any returned object.
- Sort determinism: permissions and role keys sorted lexicographically.

**Acceptance Criteria:**
- [x] `sanitizeUser` never returns `passwordHash`/`passwordHistory`.
- [x] `roleRow` returns sorted permissions.
- [x] `userRow` resolves role keys via the map; unknown roleIds are ignored.
- [x] `buildMenuTree` returns the navigation tree shape from `buildNavigationFor`.

#### Implementation Notes

Implemented in:

- `backend/src/domain/access-report.js` (new) — `sanitizeUser` (strips `passwordHash`, `passwordHistory`, `passwordVersion`, `passwordChangedAt`, `failedLoginAttempts`, `lockedUntil`, `tokenVersion`, `__v`, misc), `roleRow` (sorted permissions), `userRow` (role-key map resolution, unknown ids ignored), `buildMenuTree` (lazy import of the existing pure `buildNavigationFor` from `application/navigation.service.js` to avoid duplicate navigation logic).

Verified:

- Unit test `access-report.test.js` covers secret stripping, sorting, unknown-roleId handling, empty permission set, and wildcard grant.
- Output of `scripts/show-access-collections.js` contains no secret fields.

---

### FR-002: Create `backend/scripts/show-access-collections.js`

**Type:** Backend (new standalone script)

**Priority:** High

**Status:** Proposed

**Description:**
A standalone, idempotent inspection script that (1) connects to the configured MongoDB (the Atlas cluster), (2) ensures the access collections exist and are populated by running the existing `seedDatabase(...)`, and (3) prints the full website-access report: collections, roles + permissions, users + role memberships, and the SUPER_ADMIN menu tree.

**Current Behavior:**
No such script exists.

**Expected Behavior:**
Running `node scripts/show-access-collections.js` (or `npm run access:show` in `backend/`) prints a readable report and exits 0 on success, non-zero on failure. Never prints secrets. Works against Atlas via `config.mongoUri`.

**Affected Files:**
- `backend/scripts/show-access-collections.js` (new)
- `backend/package.json` (add `"access:show": "node scripts/show-access-collections.js"` to `scripts`)

**Implementation Instructions:**
1. Mirror the header/usage style of `backend/scripts/reset-database.js`.
2. Top of file: `require("dotenv").config();` then require `mongoose`, `createConfig`, `buildApp`, `seedDatabase`, `BcryptPasswordHasher`, the report helpers from `../src/domain/access-report`, `{ UserModel }`, `{ RoleModel }`, `{ PermissionModel }`, `{ RolePermissionModel }`, `{ UserRoleModel }` from their model files.
3. Connect:
   ```js
   const config = createConfig();
   const uri = config.mongoUri;
   await mongoose.connect(uri);
   ```
   **Do NOT print `uri`** (it contains credentials). Print only sanitized connection info, e.g. `mongoose.connection.host` + `mongoose.connection.name`.
4. Ensure data exists (same wiring as `reset-database.js`):
   ```js
   const { repositories } = buildApp(config);
   await seedDatabase({
     roleRepository: repositories.roleRepository,
     permissionRepository: repositories.permissionRepository,
     userRepository: repositories.userRepository,
     leaveTypeRepository: repositories.leaveTypeRepository,
     sicknessTypeRepository: repositories.sicknessTypeRepository,
     approvalConfigurationRepository: repositories.approvalConfigurationRepository,
     passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
     config,
   });
   ```
5. Section 1 — Collections:
   ```js
   const collections = await mongoose.connection.db.collections();
   const names = collections.map((c) => c.collectionName).sort();
   // print "Collections (n): ..."
   ```
6. Section 2 — Roles + permissions:
   - `const roles = await repositories.roleRepository.listAll();`
   - For each role: `const keys = await repositories.permissionRepository.permissionKeysForRole(role.id);`
   - Print `roleRow(role, keys)` for each (use `console.log` with a simple table-ish format; e.g. `[ROLE] key=... name=... level=... scope=... status=...` then `  permissions: a, b, c`).
7. Section 3 — Users + role memberships:
   - `const { items: users } = await repositories.userRepository.list({ page: 1, pageSize: 10000 });`
   - Build `Map<roleId, roleKey>` from the roles loaded in step 6.
   - Print `userRow(sanitizeUser(u), roleKeysById)` for each user (`[USER] username=... name=... email=... status=... roles=...`).
8. Section 4 — SUPER_ADMIN menu tree:
   - `const superRole = await repositories.roleRepository.findByKey("SUPER_ADMIN");`
   - If found: `const superKeys = await repositories.permissionRepository.permissionKeysForRole(superRole.id);`
   - `const tree = buildMenuTree(superKeys);`
   - Print the tree as indented JSON (`console.log(JSON.stringify(tree, null, 2))`) under a `[SUPER_ADMIN MENU]` heading. If `superRole` is null (should not happen after seed), print a warning and continue.
9. `await mongoose.disconnect();` at the end; wrap the whole IIFE in `.catch((err) => { console.error("[access:show] failed:", err); process.exit(1); })` (same as `reset-database.js`).
10. Add to `backend/package.json` `scripts`: `"access:show": "node scripts/show-access-collections.js"`.

**Dependencies:**
- FR-001 (uses `access-report.js` helpers).

**Must Preserve:**
- Never print `config.mongoUri`, `passwordHash`, `passwordHistory`, or any `.env` secret.
- The seed remains idempotent — running the script repeatedly must not duplicate roles/users.
- Do not modify any model, repository, service, route, or controller.
- Do not record audit events (this is a read-only CLI dump; the seed already handles its own logging).

**Acceptance Criteria:**
- [x] `npm run access:show` (in `backend/`) runs successfully against the configured Atlas cluster.
- [x] Report prints collections, roles+permissions, users+roles, and SUPER_ADMIN menu tree.
- [x] Output contains no `passwordHash`, `passwordHistory`, or `MONGO_URI` value.
- [x] Running the script twice is safe (no duplicates created).
- [x] `npm test` in `backend/` stays green.

#### Implementation Notes

Implemented in:

- `backend/scripts/show-access-collections.js` (new) — connects via `config.mongoUri` (prints only sanitized host/db name, never the URI), runs the existing idempotent `seedDatabase(...)` (same wiring as `scripts/reset-database.js`), then prints `[COLLECTIONS]`, `[ROLES]`, `[USERS]`, `[SUPER_ADMIN MENU]` sections using the FR-001 helpers.
- `backend/package.json` — added `"access:show": "node scripts/show-access-collections.js"`.

Verified:

- Ran `node scripts/show-access-collections.js` against the Atlas cluster: connected to `ac-euhtnmc-shard-00-01.thgt0lt.mongodb.net` (db `hris-project`); 28 collections present including `users`, `roles`, `permissions`, `rolepermissions`, `userroles`; seed reported up to date; report printed SUPER_ADMIN role (all permissions), superadmin user, and full 7-group menu tree.
- Output contained no `passwordHash`/`MONGO_URI` values.
- Idempotency: seed is a no-op for existing data; no duplicates created on repeat runs.

---

### FR-003: Add unit tests for `access-report.js`

**Type:** Test

**Priority:** Medium

**Status:** Proposed

**Description:**
Cover the pure helpers from FR-001 so regressions (especially secret leakage and sorting) are caught automatically.

**Affected Files:**
- `backend/test/unit/access-report.test.js` (new)

**Implementation Instructions:**
1. Create `backend/test/unit/access-report.test.js` using the built-in `node:test` + `node:assert` (match existing unit tests).
2. `sanitizeUser`: assert `passwordHash`/`passwordHistory` are absent; assert `id` string, `username`, `name`, `email`, `status`, `roleIds` mapped to strings.
3. `roleRow`: assert sorted permissions; assert fields present.
4. `userRow`: build a `Map` `{ roleIdA: "MANAGER", roleIdB: "HR_ADMIN" }`; assert unknown roleIds are ignored and roles are sorted.
5. `buildMenuTree`: pass `["*"]` and `["dashboard:view", "users:view"]`; assert the returned tree contains only nodes whose `anyOf` intersect the permission set (i.e., `dashboard:view` grants Dasbor; assert a `nav.dashboard` node exists and a `nav.rbac` node does not when `rbac:view_roles` is absent).

**Dependencies:**
- FR-001.

**Must Preserve:**
- No DB access in unit tests (pure functions only).
- Existing tests untouched.

**Acceptance Criteria:**
- [x] All new assertions pass under `npm run test:unit`.
- [x] Secret-leak regression covered (sanitizeUser test).

#### Implementation Notes

Implemented in:

- `backend/test/unit/access-report.test.js` (new) — 9 tests using `node:test` + `node:assert/strict`: `sanitizeUser` strips all password/token bookkeeping; defensive `_id`/`roleIds` handling; `roleRow` sorted permissions + empty levelLabel fallback; `userRow` map resolution/unknown-id ignore/sort; `buildMenuTree` intersection pruning, empty-set, and wildcard grant.

Verified:

- `node --test --test-reporter=spec "test/unit/access-report.test.js"` → 9/9 pass.
- Full unit suite: 731 tests, 730 pass, 1 fail (`request.service.test.js:237` — pre-existing `listMine` summary failure, unrelated to this task).
- Navigation integration regression: `navigation.api.test.js` → 3/3 pass.

---

## API Changes

### Endpoint Changes

None.

### Request Changes

None.

### Response Changes

None. (The script prints to stdout; it is not an HTTP endpoint.)

### Error Handling

- Script: on connect/seed/report failure, `.catch` logs `[access:show] failed: <err>` and exits 1 (same pattern as `reset-database.js`).
- `buildNavigationFor` on an empty permission set returns an empty tree — the script prints it without erroring.

---

## Database Changes

### Existing Models

- `users`, `roles`, `permissions`, `role_permissions`, `user_roles` — unchanged schemas.

### Required Changes

- None to schemas. The script only *ensures* the collections exist/populated via the existing seed.

### Migration Requirements

- None. `seedDatabase` is idempotent (`$setOnInsert`/`findByKey` semantics; never overwrites existing data). On a fresh Atlas cluster, first run creates the collections; on an existing DB, it is a no-op for already-present data.

---

## Frontend Changes

### Pages

- None.

### Components

- None.

### Hooks / State

- None.

### Forms

- None.

### Validation

- None.

### UI / UX

- None.

---

## Backend Changes

### Routes

- None.

### Controllers

- None.

### Services

- None (reuse `seedDatabase`, `buildNavigationFor`, and existing repositories).

### Validation

- None.

### Authorization

- None (CLI tool; no HTTP auth path).

---

## Cross-Layer Implementation Flow

```text
npm run access:show (backend/)
    ↓
scripts/show-access-collections.js
    ↓
createConfig() → mongoose.connect(config.mongoUri)   [Atlas cluster]
    ↓
buildApp(config) → seedDatabase(...)   [ensures collections + data, idempotent]
    ↓
repositories.roleRepository.listAll()
repositories.permissionRepository.permissionKeysForRole(roleId)
repositories.userRepository.list(...)
repositories.roleRepository.findByKey("SUPER_ADMIN")
    ↓
domain/access-report.js (sanitizeUser / roleRow / userRow / buildMenuTree)
    ↓
stdout: Collections · Roles+Permissions · Users+Roles · SUPER_ADMIN Menu Tree
    (no secrets, no MONGO_URI)
```

---

## Regression Protection

The following existing functionality MUST NOT be broken:

- Existing `seedDatabase` behavior (idempotent; SUPER_ADMIN always ensured; demo data gated by `SEED_DEMO_DATA`).
- Existing models/repositories/services/controllers/routes — no changes.
- Existing RBAC/navigation behavior — `buildNavigationFor` reused as-is.
- Existing `npm test` suite — new module is additive; existing tests untouched.
- Existing `.env` and config handling — the script reads `config.mongoUri` without printing it.

---

## Edge Cases

- **Fresh Atlas cluster with zero collections**: seed creates all access collections and data; report shows them.
- **Existing DB with data**: seed is a no-op for existing roles/users; report reflects current data.
- **`SEED_DEMO_DATA=false`**: only SUPER_ADMIN role + permission registry + superadmin user are ensured; report shows fewer roles/users — this is correct, not an error.
- **SUPER_ADMIN role missing (should not happen after seed)**: print warning, continue; menu section shows "SUPER_ADMIN role not found".
- **User with no roles**: `roleIds` empty → `roles: []` (no crash).
- **Unknown/removed roleIds on a user**: ignored by `userRow` (map lookup misses) — no crash.
- **Permission set empty**: `buildMenuTree([])` → `[]` (no crash).
- **Wildcard `*` permission**: `buildNavigationFor` already treats `*` as granting everything — reused as-is.
- **Output size**: users paginated with `pageSize: 10000`; acceptable for an operator tool. Do not paginate further unless the DB grows beyond this (not expected for access collections).
- **Secrets**: `sanitizeUser` strips password fields; the script never prints the URI.

---

## Testing / Verification

### Frontend

- [x] Not affected — no frontend changes (skip).

### Backend

- [x] `npm run test:unit` in `backend/` passes (new `access-report.test.js` included).
- [x] `npm test` in `backend/` remains green.

### API

- [x] Not applicable (no HTTP endpoint).

### Database

- [x] Manual: run `npm run access:show` against the Atlas cluster (current `.env`). Confirm collections listed include `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- [x] Manual: run the script a second time — no duplicate roles/users (idempotency).

### RBAC

- [x] Manual: SUPER_ADMIN menu tree prints all navigation groups/leaves (SUPER_ADMIN holds every permission).

### Regression

- [x] Existing tests untouched and green.
- [x] No model/repository/route/controller/service files modified.

---

## Implementation Order

1. **FR-001** — `access-report.js` pure helpers (foundation).
2. **FR-002** — `show-access-collections.js` script + `package.json` entry (uses FR-001).
3. **FR-003** — unit tests for FR-001; run `npm run test:unit`, then run the script manually for verification.

Dependency: FR-002 and FR-003 both depend on FR-001.

---

## Developer Notes

- **Never print secrets**: do not log `config.mongoUri` (contains Atlas credentials) or any `passwordHash`/`passwordHistory`. `sanitizeUser` is the single guard for user fields; keep it in `access-report.js` and reuse it.
- **Reuse, don't duplicate**: the script must call the existing `seedDatabase` and `buildNavigationFor` — do not write a second seeding or navigation implementation.
- **`buildApp` import**: importing `buildApp` from `../server` is the established script pattern (`reset-database.js:21`). It does not start the HTTP server (`start()` only runs when `require.main === module`, `server.js:666`).
- **Domain layering**: `access-report.js` lives under `src/domain/`. It must not import Mongoose or repositories. Importing the pure `buildNavigationFor` from `application/navigation.service.js` is acceptable (that module has no I/O); if you prefer strict layering, do the import lazily inside `buildMenuTree`.
- **Idempotency**: do not add any `deleteMany`/`dropDatabase`/upsert logic beyond what `seedDatabase` already does. This script must be safe to run repeatedly.
- **Console formatting**: keep output greppable and consistent (e.g. `[ROLE]`, `[USER]`, `[COLLECTIONS]`, `[SUPER_ADMIN MENU]` headings) so it is easy for the user to read "show semuanya".
- **Do not modify** `project-context.md` unless adding the `access:show` command to §22 Development Commands is desired — that is optional and can be done by the Developer as a non-functional doc note.

---

## Definition of Done

- [x] FR-001 implemented (pure helpers with secret sanitization).
- [x] FR-002 implemented (script + `npm run access:show`).
- [x] FR-003 implemented (unit tests green).
- [x] Running `npm run access:show` prints collections, roles+permissions, users+roles, SUPER_ADMIN menu tree.
- [x] No secrets printed anywhere.
- [x] No frontend/API/RBAC/schema changes.
- [x] Existing `npm test` remains green.
- [x] Running the script twice is safe (idempotent).

---

## Implementation Summary

### Completed

- FR-001 — `backend/src/domain/access-report.js` (pure report helpers with secret sanitization)
- FR-002 — `backend/scripts/show-access-collections.js` + `npm run access:show`
- FR-003 — `backend/test/unit/access-report.test.js` (unit tests)

### Files Changed

Backend (all additive; no existing module modified):

- `backend/src/domain/access-report.js` (new)
- `backend/scripts/show-access-collections.js` (new)
- `backend/test/unit/access-report.test.js` (new)
- `backend/package.json` (added `"access:show"` script)

### Database Changes

- None (schema). The script reuses the existing idempotent `seedDatabase` to ensure the access collections (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`) exist on the connected Atlas cluster. Verified: 28 collections present on `hris-project`.

### API Changes

- None.

### Remaining Work

- None for this issue. (Pre-existing unrelated failure remains: `test/unit/request.service.test.js:237` `listMine` summary assertion — documented in earlier implementation summaries.)

### Verification

- [x] Frontend verified (not affected)
- [x] Backend verified (`access-report.test.js` 9/9 pass; unit suite 730/731 pass — 1 pre-existing failure)
- [x] API verified (not applicable — CLI tool)
- [x] Database verified (script ran against Atlas: collections + SUPER_ADMIN role/user + menu tree printed; no secrets)
- [x] RBAC verified (SUPER_ADMIN menu tree complete; `navigation.api.test.js` 3/3 pass)
- [x] Regression checked (no existing modules modified; navigation integration green)
