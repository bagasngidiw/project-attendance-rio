# Technical Implementation TODO

## Issue Summary

### User Request

(English, verbatim intent) — "Inspect the codebase (router definitions, controller logic, Multer file storage configurations) to correctly expose static file directories in Express. Target directories in root: `attachment-assets`, `attendance-media`, `branding-assets`, `salary-assets`.

1. Search where files are uploaded/retrieved for each domain (Attendance, Salary, Platform/Branding, Attachments).
2. Identify the exact URL prefix expected by the frontend for each resource type under `/api/v1/`.
3. Mount `express.static` for each directory matching its corresponding route prefix, using `path.join(__dirname, '<folder_name>')`.
4. Ensure these `express.static` declarations are declared BEFORE any catch-all 404 or router fallbacks in `server.js` / application builder."

### Problem

The backend currently has **zero `express.static` mounts** (`grep` for `express.static` across `backend/` returns no matches). All four local-disk directories are served exclusively through controllers in `backend/server.js` composition root:

- `branding-assets` → public controller `GET /api/v1/platform/branding-assets/:token` (`createBrandingAssetRoutes`)
- `attendance-media` → protected controller `GET /api/v1/attendance/media/:token` (`createAttendanceRoutes`, requires `authenticate` + `attendance:view_own|view_all` + CSP/nosniff headers + audit)
- `attachment-assets` → protected controller `GET /api/v1/attachments/:id/download` (`createAttachmentRoutes`, requires `authenticate` + `files:download` + request-scoped service check)
- `salary-assets` → protected controller `GET /api/v1/salary-slips/:id/download` (`createSalarySlipRoutes`, requires `authenticate` + `salary:view_own|salary:manage` + ownership check)

The frontend does **not** use static-style file URLs for any of these — every asset is fetched through the authenticated/public controller routes above (verified in `frontend/src/lib/axios.ts` and feature components). The request is to add `express.static` mounts. The challenge: three of the four directories contain **private data** (attendance selfies = PII, request attachments, salary slips). Blindly mounting public `express.static` at their API prefixes would create security holes.

### Expected Result

- `express.static` mounts added in `backend/server.js` for the directories where it is safe and correct, declared **before** every `/api/v1` router and the catch-all 404 handler (`createNotFoundHandler()`).
- Existing controller routes keep working (static mounts use `fallthrough`, so misses continue to the routers; route shadowing avoided).
- Private directories are NOT exposed publicly; where a static mount is added for a private directory it is placed **behind the existing `authenticate` middleware**, and the security tradeoff is documented.
- Backend test suite still passes; manual curl verification confirms the exact behaviors.

### Issue Classification

- Backend Change (Express static serving)
- Security Change (static exposure must not bypass RBAC)

### Scope

- **Backend-only, single file:** `backend/server.js`.
- No controller/route/service/model/frontend/contract changes.
- No database changes. No new dependencies (`express.static` is built-in).

---

## Existing Architecture

### Relevant Frontend

- `frontend/src/lib/axios.ts` — the single axios client; every asset fetch uses controller URLs:
  - `attendanceApi.uploadMedia` → `POST /api/v1/attendance/media`; `attendanceApi.getMedia(token)` → `GET /api/v1/attendance/media/:token` (blob) — line ~765-773.
  - `brandingApi.public()` → `GET /api/v1/platform/branding`; logo URL comes from the payload (`logo.url = /api/v1/platform/branding-assets/<key>`) fetched via `fetchBlobObjectUrl` — `lib/branding.ts:101,247`.
  - `attachmentApi.downloadUrl(id)` → `/attachments/:id/download` — line ~707.
  - `salarySlipApi.downloadUrl(id)` → `/salary-slips/:id/download` — line ~895.
- Feature consumers: `features/attendance/AttendanceDetailDialog.tsx` (extracts token from `mediaRef`), `features/attendance/AttendanceVerificationPanel.tsx` + `useAttendanceVerification.ts` (mediaRef round-trip), `features/salary-slips/*` and `features/requests/*` (download links).
- **No frontend change is needed or desired** — the static mounts are additive and must not change the URLs the frontend already uses.

### Relevant Backend

- `backend/server.js` (759 lines) — the Express composition root. Key facts:
  - Storage instances: `logoStorage` (line 224, dir = `process.env.BRANDING_ASSETS_DIR || path.join(process.cwd(), "branding-assets")`), `attachmentStorage` (line 426, dir = `config.attachmentAssetsDir` → `ATTACHMENT_ASSETS_DIR || path.join(process.cwd(), "attachment-assets")`), `salarySlipStorage` (line 441, dir = `config.salaryAssetsDir` → `SALARY_ASSETS_DIR || path.join(process.cwd(), "salary-assets")`), `attendanceMediaStorage` (line 568, dir = `process.env.ATTENDANCE_MEDIA_DIR || path.join(process.cwd(), "attendance-media")`).
  - Global middleware order: `securityHeaders` (587) → `cors` (609) → `express.json` (618) → `correlation` (620) → `/health` (622) → all `/api/v1` routers (624-696) → `createNotFoundHandler()` (698) → `createErrorHandler()` (699).
  - `authenticate`/`authorize` middleware constructed at lines 526-532 (before app assembly — available for use in static mounts).
  - `require("path")` is used inline (lines 225, 570); no top-level `const path = require("path")` — the static block should introduce one or reuse inline.
- `backend/src/infrastructure/storage/local-disk.storage.js` — sandboxed key→file storage; files are stored **flat** in each directory with keys:
  - `branding-assets`: `logo-<Date.now()>-<12 hex>.<ext>` (`branding.service.js:139`)
  - `attendance-media`: `selfie_<48 hex>.png|jpg` (`attendance.controller.js:72-74`)
  - `attachment-assets`: `<uuid>-<sanitized basename>` (`domain/attachment.js:59-63` `sanitizeStoredName`)
  - `salary-assets`: `slip-<32 hex><ext>` (`salary-slip.service.js:79`)
- Controllers that currently serve files: `attendance.controller.js` (`uploadMedia`/`getMedia`), `branding.controller.js` (`getAsset`), `attachment.controller.js` (`download`), `salary-slip.controller.js` (`download`).

### Relevant Database

- None. Files live on local disk; the DB stores metadata (`mediaRef`, attachment `key`, salary `storageKey`) only.

### Relevant API

- Existing endpoints are unchanged and must remain reachable:
  - `GET /api/v1/platform/branding-assets/:token` (public)
  - `GET /api/v1/attendance/media/:token` (protected)
  - `GET /api/v1/attachments/:id/download` (protected)
  - `GET /api/v1/salary-slips/:id/download` (protected)
- New additive behavior: direct static file GETs under the new mounts (see FRs).

### Relevant Authentication

- `authenticate` (JWT + session + tokenVersion) is the existing gate. The attendance-media static mount (FR-003) must run behind `authenticate` so unauthenticated requests to the mount still 401.

### Relevant Authorization / RBAC

- Attendance media: currently `authorize("attendance:view_own", "attendance:view_all")` on the controller route. The static mount (FR-003) will only require `authenticate` — **any authenticated user** could fetch a file whose exact filename they know. This is a documented, accepted tradeoff for this task (filenames are 48-hex unguessable capability tokens); the controller route remains the primary, fully-authorized path.
- Branding: public by design — no RBAC.
- Attachments/salary: **must NOT be exposed publicly** (FR-004 analysis).

### Relevant Navigation

- None.

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | Not Affected | No frontend code changes; existing controller URLs keep working |
| Backend | Affected | `backend/server.js` only — static mounts + directory resolution |
| Database | Not Affected | No schema/data changes |
| API | Potentially Affected | Additive static GET endpoints; existing routes preserved via `fallthrough` |
| Authentication | Affected | Attendance-media static mount requires `authenticate` |
| Authorization / RBAC | Potentially Affected | Static mount for attendance media relaxes per-route authorization to any authenticated user (documented tradeoff); attachments/salary remain controller-protected (FR-004) |
| Navigation | Not Affected | — |
| UI/UX | Not Affected | — |
| Business Logic | Not Affected | Services untouched |
| Validation | Not Affected | — |
| File Storage | Affected | Static serving of the four local-disk directories is the entire point of this change |
| Notifications | Not Affected | — |
| Reports | Not Affected | — |
| Audit Logs | Potentially Affected | Direct static GETs of attendance media bypass the `ATTENDANCE.MEDIA_VIEWED` audit that the controller performs (documented in FR-003) |
| Performance | Not Affected | `express.static` is the standard high-performance static path |
| Testing | Potentially Affected | Backend suite must still pass; add manual curl checks (no new test files required) |

---

## Functional Requirements

### FR-001: Add shared static-directory resolution and the static mount block in `server.js`

**Type:** Backend

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented in `backend/server.js` (the only file touched, per scope):

- Added `const path = require("path");` at the top-level requires (line 8).
- Inserted the static block between `app.use(correlation)` and `app.get("/health", ...)`, resolving the four directories with the SAME env-override expressions as the storage instances (`logoStorage`, `attendanceMediaStorage`, `attachmentStorage`, `salarySlipStorage`):
  - `brandingAssetsDir = process.env.BRANDING_ASSETS_DIR || path.join(process.cwd(), "branding-assets")`
  - `attendanceMediaDir = process.env.ATTENDANCE_MEDIA_DIR || path.join(process.cwd(), "attendance-media")`
  - `attachmentAssetsDir = config.attachmentAssetsDir`
  - `salaryAssetsDir = config.salaryAssetsDir`
- Mount order preserved: `securityHeaders → cors → json → correlation → static → health → routers → 404 → error`.

**Description:**
Introduce a single static-mount block in `buildApp` (inside `backend/server.js`) that (1) resolves the four directories using the SAME expressions the storage instances use (env override → `path.join(process.cwd(), "<folder>")`), and (2) registers the static mounts from FR-002/FR-003/FR-004. The block is placed AFTER the global middleware (`securityHeaders` → `cors` → `express.json` → `correlation`) and BEFORE the `/health` route and every `/api/v1` router — satisfying "declared BEFORE any catch-all 404 or router fallbacks".

**Current Behavior:**
- No static mounts exist; all `/api/v1` routers run, then `createNotFoundHandler()` (404) and `createErrorHandler()`.

**Expected Behavior:**
- A clearly-commented block between `app.use(correlation)` (line 620) and `app.get("/health", ...)` (line 622) containing the static mounts.
- Directory constants resolve identically to the storage instances:
  - `brandingAssetsDir = process.env.BRANDING_ASSETS_DIR || path.join(process.cwd(), "branding-assets")`
  - `attendanceMediaDir = process.env.ATTENDANCE_MEDIA_DIR || path.join(process.cwd(), "attendance-media")`
  - `attachmentAssetsDir = config.attachmentAssetsDir` (already `ATTACHMENT_ASSETS_DIR || path.join(process.cwd(), "attachment-assets")` in `config.js`)
  - `salaryAssetsDir = config.salaryAssetsDir` (already `SALARY_ASSETS_DIR || path.join(process.cwd(), "salary-assets")` in `config.js`)
- Add `const path = require("path");` at the top of `server.js` (near line 7-10) so the block can use `path.join(__dirname, ...)` / `path.join(process.cwd(), ...)` without repeating inline requires.

**Affected Files:**
- `backend/server.js`

**Implementation Instructions:**
1. Add `const path = require("path");` to the top-level requires (do not duplicate the inline `require("path")` at lines 225/570 — they may stay, or be simplified to use the top-level const; prefer leaving existing lines untouched to minimize diff).
2. Insert the static block after line 620 (`app.use(correlation);`) and before line 622 (`app.get("/health", ...)`):
   ```js
   // ── Static file directories (express.static) ────────────────────────────
   // Resolved with the SAME env overrides as the LocalDiskStorage instances
   // so static serving always points at the exact directory the app writes to.
   // Mounted BEFORE the /api/v1 routers and the catch-all 404 handler.
   const brandingAssetsDir = process.env.BRANDING_ASSETS_DIR || path.join(process.cwd(), "branding-assets");
   const attendanceMediaDir = process.env.ATTENDANCE_MEDIA_DIR || path.join(process.cwd(), "attendance-media");
   const attachmentAssetsDir = config.attachmentAssetsDir;
   const salaryAssetsDir = config.salaryAssetsDir;
   ```
3. In the same block, invoke the static mounts defined by FR-002/FR-003/FR-004 (the developer implements those FRs as part of this block).
4. Keep `securityHeaders` global (line 587) — static responses already pass through it.

**Dependencies:**
- FR-002, FR-003, FR-004 (the mounts placed inside this block).

**Must Preserve:**
- Global middleware order (securityHeaders → cors → json → correlation → static → health → routers → 404 → error).
- All existing `/api/v1` router behavior.

**Acceptance Criteria:**
- [x] `path` is available at the top of `server.js`; the static block sits between `correlation` and `/health`.
- [x] The four directory constants resolve to the same directories as the four `LocalDiskStorage` instances (verified when `BRANDING_ASSETS_DIR`/`ATTENDANCE_MEDIA_DIR`/`ATTACHMENT_ASSETS_DIR`/`SALARY_ASSETS_DIR` are unset and when set).

---

### FR-002: Mount `express.static` for `branding-assets` (public)

**Type:** Backend / Security-safe

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented in `backend/server.js` static block: public mount at `/api/v1/platform/branding-assets` with `{ index: false, fallthrough: true, maxAge: "1d", setHeaders: nosniff }`, mounted BEFORE `createBrandingAssetRoutes` (line 640 region). Verified by supertest: `GET /api/v1/platform/branding-assets/<existing logo>` (no auth) → 200 with `X-Content-Type-Options: nosniff`; unknown tokens fall through to the public controller (404 envelope preserved).

**Description:**
Serve `branding-assets/` publicly at `/api/v1/platform/branding-assets` — the exact prefix the frontend already uses for logos (`branding.service.js:143` returns `url: /api/v1/platform/branding-assets/<key>`, fetched via the public branding-asset controller today). This directory is public by design; a static mount is safe and matches the user's example pattern.

**Current Behavior:**
- `GET /api/v1/platform/branding-assets/:token` is handled by the public controller (`branding.routes.js:32-36` → `branding.controller.js getAsset`), which reads the file by token/key and sends it with nosniff + `Cache-Control: public, max-age=86400`.

**Expected Behavior:**
- `app.use("/api/v1/platform/branding-assets", express.static(brandingAssetsDir, { index: false, fallthrough: true, maxAge: "1d", setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff") }));`
- Mounted BEFORE the existing `app.use("/api/v1/platform/branding-assets", createBrandingAssetRoutes(...))` (line 640) — direct filename GETs (e.g. `logo-<ts>-<hex>.png`) are served by static; any other token falls through to the controller (`getAsset`), so the existing route keeps working.
- `GET /api/v1/platform/branding-assets/<missing>` → static misses → controller → `NotFoundError` → 404 envelope (existing behavior preserved).

**Affected Files:**
- `backend/server.js` (static block from FR-001)

**Implementation Instructions:**
1. In the static block, add the branding mount with the options above.
2. Do not add `authenticate` — this mount is intentionally public (logos).
3. Do not change `createBrandingAssetRoutes` / `BrandingController.getAsset`.
4. Log nothing sensitive.

**Dependencies:**
- FR-001.

**Must Preserve:**
- Public branding controller route and the `Cache-Control`/nosniff headers on controller-served assets.
- No authentication on branding assets (login page theming depends on it).

**Acceptance Criteria:**
- [x] `GET /api/v1/platform/branding-assets/<existing logo filename>` returns 200 with the file bytes **without any Authorization header**.
- [x] `GET /api/v1/platform/branding-assets/<unknown token>` still returns the 404 envelope (controller path).
- [x] The frontend branding bootstrap (`lib/branding.ts`) still loads the logo.

---

### FR-003: Mount `express.static` for `attendance-media` behind `authenticate`

**Type:** Backend / Security-aware

**Priority:** High

**Status:** Implemented

#### Implementation Notes

Implemented in `backend/server.js` static block: `app.use("/api/v1/attendance/media", authenticate, express.static(attendanceMediaDir, { index: false, fallthrough: true, redirect: false, setHeaders: nosniff + Cache-Control private,no-store }))`, mounted BEFORE `createAttendanceRoutes` (line 684 region). Reuses the existing `authenticate` const. Verified by supertest: `GET /api/v1/attendance/media/<file>` (no auth) → 401; with a valid token → 200 + nosniff; the frontend capability-token route (`<48-hex>`, no `selfie_` prefix) never matches a stored file → falls through to the protected controller (CSP + audit + attendance perms) exactly as before.

**Description:**
Serve `attendance-media/` at `/api/v1/attendance/media` — the prefix the frontend already uses for selfies (`mediaRef = /api/v1/attendance/media/<token>`, fetched via `attendanceApi.getMedia`). Because selfies are PII, the static mount MUST run behind the existing `authenticate` middleware (never public). Static only serves GET/HEAD; `POST /api/v1/attendance/media` (upload) is untouched.

**Current Behavior:**
- `POST /api/v1/attendance/media` returns `mediaRef: /api/v1/attendance/media/<token>`; `GET /api/v1/attendance/media/:token` is handled by the protected controller (authenticate + `attendance:view_own|view_all` + CSP/nosniff + `ATTENDANCE.MEDIA_VIEWED` audit). Files are stored as `selfie_<token>.png|jpg` — the `<token>` in the URL is NOT the filename (no `selfie_` prefix, no extension).

**Expected Behavior:**
- `app.use("/api/v1/attendance/media", authenticate, express.static(attendanceMediaDir, { index: false, fallthrough: true, redirect: false, setHeaders: (res) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Cache-Control", "private, no-store"); } }));`
- Mounted BEFORE the `app.use("/api/v1/attendance", createAttendanceRoutes(...))` (line 684).
- The frontend's existing requests `GET /api/v1/attendance/media/<token>`: static looks for a file literally named `<token>` (miss, because real files are `selfie_<token>.png|jpg`) → **falls through** to the attendance router → the protected controller serves exactly as today (CSP, audit, authorization intact).
- A direct request `GET /api/v1/attendance/media/selfie_<token>.png` (exact stored filename) is served by static to any **authenticated** user.
- `POST /api/v1/attendance/media` passes through static (static handles only GET/HEAD) → upload flow unchanged.
- Unauthenticated `GET` to the mount → 401 from `authenticate`.

**Affected Files:**
- `backend/server.js` (static block from FR-001)

**Implementation Instructions:**
1. In the static block, add the attendance-media mount with `authenticate` FIRST (the `authenticate` const is already in scope — constructed at line 526).
2. Verify the existing integration tests that exercise `/attendance/media/:token` (if any) still pass — static misses must fall through (this is guaranteed by `fallthrough: true`, the default).
3. Do NOT modify `AttendanceController.getMedia` / `attendance.routes.js`.
4. Add a short comment documenting: "frontend token route stays authoritative (CSP + audit + attendance perms); this static mount only serves direct filename GETs to authenticated users."

**Dependencies:**
- FR-001.

**Must Preserve:**
- The protected token route (`GET /attendance/media/:token`) with CSP headers and audit.
- The upload flow (`POST /attendance/media`).
- Unauthenticated access denial (401).

**Acceptance Criteria:**
- [x] `GET /api/v1/attendance/media/<token>` (as returned by upload) still returns the selfie through the controller path (static falls through) with the existing CSP/nosniff headers.
- [x] `GET /api/v1/attendance/media/selfie_<token>.png` WITHOUT an Authorization header → 401.
- [x] `GET /api/v1/attendance/media/selfie_<token>.png` WITH a valid user token → 200 (any authenticated user; documented tradeoff).
- [x] `POST /api/v1/attendance/media` still uploads (201).
- [x] No `X-Content-Type-Options` missing on static responses (nosniff set via `setHeaders`).

---

### FR-004: Attachments + salary slips — security analysis and decision-gated static mount

**Type:** Backend / Security decision

**Priority:** High

**Status:** Implemented (operator explicitly overrode the default — gated `/files` alternative)

#### Implementation Notes

The default (no static mount for attachments/salary) was analyzed and documented, then **the operator explicitly overrode** it (request: "do the express.static one to all attachment based on the feature"). Implemented the decision-gated alternative in `backend/server.js`:

```js
app.use("/api/v1/attachments/files", authenticate, express.static(attachmentAssetsDir, { index: false, fallthrough: true, redirect: false, setHeaders: nosniff + Cache-Control private,no-store }));
app.use("/api/v1/salary-slips/files", authenticate, express.static(salaryAssetsDir, { index: false, fallthrough: true, redirect: false, setHeaders: nosniff + Cache-Control private,no-store }));
```

- Dedicated `/files` sub-prefixes that never collide with the DB-id download routes (`/api/v1/attachments/:id/download`, `/api/v1/salary-slips/:id/download` — both unchanged and still fully authorized).
- Verified by supertest: `GET /api/v1/attachments/<raw stored filename>` (no auth) → NOT 200 (never public); `GET /api/v1/attachments/files/<filename>` no-auth → 401, with token → 200; `GET /api/v1/salary-slips/files/<file>` no-auth → 401.
- Security tradeoff documented in code (NOT RECOMMENDED comment): exposes private documents to any authenticated user who knows the exact stored filename; the frontend does not use these URLs.

**Description:**
Analyze whether `attachment-assets/` and `salary-assets/` should get `express.static` mounts, and implement the safe outcome.

**Security analysis (verified against source):**
- Frontend prefixes for these resources are **DB-id download routes, NOT static-file routes**:
  - `attachmentApi.downloadUrl(id)` → `/api/v1/attachments/:id/download` (id = Mongo `_id` of the attachment record).
  - `salarySlipApi.downloadUrl(id)` → `/api/v1/salary-slips/:id/download` (id = Mongo `_id` of the slip record).
- The files on disk use storage keys, not the ids:
  - `attachment-assets` → `<uuid>-<sanitized original basename>` (`sanitizeStoredName`, `domain/attachment.js:59-63`). The basename portion is the original client filename (e.g. `CV_Fullstack_Developer_Dony_Marsahid_0326.pdf`) — **guessable/leakable**.
  - `salary-assets` → `slip-<32 hex><ext>` (unguessable, but `storageKey` is deliberately NEVER exposed in DTOs — `salary-slip.service.js:9`).
- Mounting `express.static` at `/api/v1/attachments` or `/api/v1/salary-slips` would:
  1. **Expose private documents publicly** (no auth): e.g. `GET /api/v1/attachments/<uuid>-CV_....pdf` would serve the raw attachment to anyone; same for salary slips.
  2. **Interfere with the existing routers** (shadowing risk around `/api/v1/attachments/:id/download` and `/api/v1/salary-slips/:id/download`).
  3. Provide **no benefit to the frontend** — the frontend does not use filename-based URLs for these.
- Both resources are ALREADY served correctly by the protected controllers with request-scoped authorization (`attachment.service.js` asserts request access; `salary-slip.service.js` asserts ownership/`salary:view_own|salary:manage`).

**Recommended outcome (default implementation):**
- **Do NOT mount `express.static` for `attachment-assets` or `salary-assets` at `/api/v1/attachments` or `/api/v1/salary-slips`.** Leave the two directories served exclusively by their protected controllers. Add a code comment in the static block documenting this decision (with the two controller routes named), so the reasoning is preserved for future maintainers.

**Decision-gated alternative (implement ONLY if the user explicitly overrides the recommendation):**
- Mount behind `authenticate` under dedicated sub-prefixes that never collide with the download routes:
  ```js
  // NOT RECOMMENDED — exposes private documents to any authenticated user
  // who knows the exact stored filename. The frontend does not use these URLs.
  app.use("/api/v1/attachments/files", authenticate, express.static(attachmentAssetsDir, { index: false, fallthrough: true, redirect: false }));
  app.use("/api/v1/salary-slips/files", authenticate, express.static(salaryAssetsDir, { index: false, fallthrough: true, redirect: false }));
  ```
- This alternative keeps authentication but drops request-scoped authorization; it is strictly a security tradeoff and must not be the default.

**Affected Files:**
- `backend/server.js` (static block from FR-001 — comment + optional gated mounts)

**Implementation Instructions:**
1. Default: add the documented comment block; do NOT add static mounts for these two directories.
2. If the user overrides: add the two mounts above behind `authenticate`, under the dedicated `/files` sub-prefixes, with the warning comment.

**Dependencies:**
- FR-001.

**Must Preserve:**
- `GET /api/v1/attachments/:id/download` and `GET /api/v1/salary-slips/:id/download` (auth + request-scoped/ownership checks + `Content-Disposition`).
- `storageKey` never exposed in any DTO.

**Acceptance Criteria:**
- [x] Default outcome: no public static path exists for attachments or salary slips; `GET /api/v1/attachments/<uuid>-<name>.pdf` (no auth) returns the 404 envelope (or 401), never the file.
- [x] `GET /api/v1/attachments/:id/download` and `GET /api/v1/salary-slips/:id/download` behave exactly as before.
- [x] The static block contains the documented security rationale. *(Operator override: gated `/files` mounts behind `authenticate` added per explicit request; NOT RECOMMENDED warning preserved in code.)*

---

### FR-005: Verify static mounts (ordering, regression, manual curl)

**Type:** Verification / QA

**Priority:** Medium

**Status:** Implemented

#### Implementation Notes

- **Unit tests at the time of the static-file change:** `npm run test:unit` → 762 tests, 761 pass, 1 fail — the single failure was the FR-037 `request.service.test.js` `listMine` summary assertion. The later production-hardening scope fixed that assertion and restored the boot guard; the current full-suite result is recorded below.
- **Manual supertest verification** (scratch script against `buildApp`, local DB): ALL checks passed — branding static 200/no-auth, attendance static 401/no-auth + 200/with-token, attachments raw prefix never 200, gated `/attachments/files` + `/salary-slips/files` 401/no-auth + 200/with-token, unknown `/api/v1/...` path → 404 envelope (404 handler last).
- **Full `npm test` at the time of the static-file change:** the integration suite was blocked by the in-flight unconditional `start()`; the production-hardening scope below restored the direct-execution guard and re-ran the complete suites successfully.

**Description:**
Verify the static mounts are placed correctly (before routers/404), existing routes are unaffected, and the backend suite passes.

**Expected Behavior:**
- `npm test` in `C:\Attendance System\backend` passes (the suite exercises `buildApp`; static mounts are additive and must not break existing controller tests, especially attendance media and branding).
- Manual curl checks (below) confirm public vs protected behavior.

**Affected Files:**
- None (verification only; no new test files required — writing real files into the static dirs during tests is avoided)

**Implementation Instructions:**
1. Run `npm test` in `C:\Attendance System\backend`.
2. Manual checks (start the server or use `buildApp` via a scratch script):
   - `GET /api/v1/platform/branding-assets/<existing-logo>` (no auth) → 200.
   - `GET /api/v1/attendance/media/<token>` (no auth) → 401.
   - `GET /api/v1/attendance/media/selfie_<token>.png` (no auth) → 401; (with token) → 200.
   - `GET /api/v1/attachments/<uuid>-<name>.pdf` (no auth) → NOT the file (404/401).
   - `POST /api/v1/attendance/media`, `GET /api/v1/attachments/:id/download`, `GET /api/v1/salary-slips/:id/download`, `GET /api/v1/platform/branding` still behave as before.
3. Confirm mounts appear in the request flow BEFORE the 404 handler (mount order verified by the acceptance checks).

**Dependencies:**
- FR-001..FR-004.

**Must Preserve:**
- No modification of test data; no new committed test files.

**Acceptance Criteria:**
- [x] Backend test verification is complete after the production-hardening scope: unit suite 778/778 and integration suite 131/131.
- [x] All manual curl checks above pass.
- [x] Mount order verified: a request to an unknown `/api/v1/...` path still returns the 404 envelope (proves the 404 handler is last).

---

## API Changes

### Endpoint Changes

- Additive only:
  - `GET /api/v1/platform/branding-assets/<filename>` — new public static serving of stored logos (falls back to the existing public controller for other tokens).
  - `GET /api/v1/attendance/media/<filename>` — new static serving of stored selfies **behind `authenticate`** (falls through to the existing protected controller for capability-token requests).
- No changes to `attachment-assets` / `salary-assets` (default outcome of FR-004: no static; controller routes unchanged).

### Request Changes

None.

### Response Changes

None for existing endpoints. Static responses carry `securityHeaders` (global) + `setHeaders` options.

### Error Handling

- Static misses fall through (`fallthrough: true`) to the existing routers → 404 envelope or controller NotFound, exactly as today.
- Unauthenticated requests to the attendance static mount → 401 (from `authenticate`).

---

## Database Changes

### Existing Models

None involved.

### Required Changes

None.

### Migration Requirements

None.

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

None. The frontend continues to use its existing controller URLs; nothing visual changes.

---

## Backend Changes

### Routes

- `backend/server.js` — static mount block (FR-001..FR-004). No changes to route factory files.

### Controllers

None.

### Services

None.

### Validation

None.

### Authorization

- Branding static: public (unchanged intent).
- Attendance static: `authenticate`-gated (documented tradeoff; controller route remains fully authorized).
- Attachments/salary: unchanged (controller-protected).

---

## Cross-Layer Implementation Flow

```text
Frontend (unchanged)
    ↓
GET /api/v1/platform/branding-assets/<logo>      → express.static (public) OR public controller fallback
GET /api/v1/attendance/media/<token>             → static misses → attendance router → controller (auth + CSP + audit)
GET /api/v1/attendance/media/selfie_<token>.png  → authenticate → express.static (raw file)
GET /api/v1/attachments/:id/download             → controller (auth + files:download + request scope)
GET /api/v1/salary-slips/:id/download            → controller (auth + salary:* + ownership)
    ↓
404 catch-all (last) / error handler (last)
```

No frontend/API/DB layer changes — the change is entirely within the Express middleware chain in `server.js`.

---

## Regression Protection

The following existing functionality MUST NOT be broken:

- `GET /api/v1/attendance/media/:token` (protected controller; CSP + nosniff + `ATTENDANCE.MEDIA_VIEWED` audit).
- `POST /api/v1/attendance/media` (multer upload; mediaRef flow).
- `GET /api/v1/platform/branding-assets/:token` and `GET /api/v1/platform/branding` (public branding bootstrap).
- `GET /api/v1/attachments/:id/download`, `GET /api/v1/salary-slips/:id/download` (auth + scoped authorization + `Content-Disposition`).
- Global middleware order and the catch-all 404/error handlers.
- All other `/api/v1` routers (mounted after the static block; `fallthrough` prevents shadowing).
- Backend test suite (integration tests build the app through `buildApp`).
- All in-flight working-tree changes (salary-slips feature, approval tweaks, header responsiveness) — do not touch them.

---

## Edge Cases

- **Static dir does not exist yet** (fresh clone): `express.static` on a missing dir is harmless — requests fall through to controllers (which 404 via the storage layer).
- **Env override present** (`BRANDING_ASSETS_DIR`, `ATTENDANCE_MEDIA_DIR`, `ATTACHMENT_ASSETS_DIR`, `SALARY_ASSETS_DIR` pointing at a Render persistent disk): static must serve the SAME resolved dir as the storage instance — FR-001 uses the same resolution expressions, so no mismatch.
- **Filename vs capability token for attendance**: the frontend token URL (`<48-hex>`, no `selfie_` prefix, no extension) never matches a real file → always falls through to the controller; only the full stored filename matches static.
- **Traversal attempts**: `express.static` normalizes paths and rejects `..` traversal by default (`path.resolve` sandbox in `LocalDiskStorage` also blocks it on write/read).
- **`POST` to a static mount**: static handles only GET/HEAD; POST passes through to routers (upload flows unaffected).
- **Directory listing**: prevented via `index: false` and `redirect: false`.
- **Audit bypass**: direct static GETs of attendance selfies do not emit `ATTENDANCE.MEDIA_VIEWED` (documented tradeoff; controller path still audits).

---

## Testing / Verification

### Frontend

- [x] Not applicable (no frontend changes). Spot-check the branding logo still loads on the login page and dashboard.

### Backend

- [x] Backend verification completed after the production-hardening scope (unit 778/778; integration 131/131).

### API

- [x] `GET /api/v1/platform/branding-assets/<existing logo>` (no auth) → 200.
- [x] `GET /api/v1/attendance/media/<token>` (no auth) → 401; with auth → 200 via controller (CSP headers present).
- [x] `GET /api/v1/attendance/media/selfie_<token>.png` (no auth) → 401; with auth → 200.
- [x] `GET /api/v1/attachments/<uuid>-<name>.pdf` (no auth) → not the file.
- [x] `POST /api/v1/attendance/media`, `GET /api/v1/attachments/:id/download`, `GET /api/v1/salary-slips/:id/download` unchanged.

### Database

- [x] Not applicable (no DB change).

### RBAC

- [x] Attendance static requires authentication (401 without token).
- [x] Attachments/salary downloads still require `files:download` / `salary:*` + scoped checks.

### Regression

- [x] Unknown `/api/v1/...` path returns the 404 envelope (404 handler still last).
- [x] Backend suite passes; no unrelated production modules were modified by the original static-file task.

---

## Implementation Order

1. **FR-001** — static block + directory resolution + `path` import (container).
2. **FR-002** — branding static mount (public).
3. **FR-003** — attendance-media static mount behind `authenticate`.
4. **FR-004** — attachments/salary decision (default: no mount + documented rationale).
5. **FR-005** — verification (`npm test` + curl checks).

FR-002/FR-003/FR-004 are independent of each other but all live inside the FR-001 block; implement in the order above, then run FR-005.

---

## Developer Notes

- **Scope discipline:** modify ONLY `backend/server.js`. Do not touch controllers, routes, services, models, `config.js`, frontend, contracts, or the in-flight working-tree changes.
- **Do NOT add public static for attachments/salary** (FR-004). The default is "no static mount" with a documented comment. Only implement the gated `/files` alternative if the user explicitly confirms.
- **Reuse the existing `authenticate` const** (already constructed before app assembly) for the attendance-media mount — do not construct a second auth middleware.
- **Match the storage directories exactly**: use the same env-override expressions as the storage instances (FR-001), never a hardcoded `__dirname` guess that could diverge when env vars are set (Render persistent disk).
- **`fallthrough: true` is essential** — without it, static would respond 404 for misses and break the existing controller routes.
- **Never print or log** file contents, filenames of private documents, or directory paths containing secrets.
- **No new dependencies** — `express.static` is built into Express.

---

## Definition of Done

- [x] All Functional Requirements implemented (FR-001..FR-005).
- [x] `express.static` mounts present in `backend/server.js` before every `/api/v1` router and the catch-all 404.
- [x] Branding assets publicly served; attendance media served behind `authenticate`; attachments/salary served behind `authenticate` under dedicated `/files` prefixes (operator override of the no-mount default).
- [x] Existing controller routes and frontend flows unchanged.
- [x] Backend test suite passes after hardening (unit 778/778; integration 131/131).
- [x] Manual curl checks pass.
- [x] No unrelated modules modified; no new dependencies. *(Only `backend/server.js` modified.)*
- [x] Security rationale documented in code for the FR-004 decision.

---

## Implementation Summary

### Completed

- FR-001 — Static-directory resolution + static mount block in `backend/server.js` (before `/health` + routers + 404).
- FR-002 — Public `express.static` for `branding-assets` at `/api/v1/platform/branding-assets` (fallthrough to the public controller).
- FR-003 — `express.static` for `attendance-media` at `/api/v1/attendance/media` behind the existing `authenticate` (controller token route stays authoritative).
- FR-004 — Security analysis + operator override: gated `express.static` for `attachment-assets` and `salary-assets` behind `authenticate` under `/api/v1/attachments/files` and `/api/v1/salary-slips/files` (NOT RECOMMENDED tradeoff documented in code).
- FR-005 — Verified: manual supertest checks (all pass), 404 ordering; the later hardening scope completed the full backend suites.

### Files Changed

- `backend/server.js` (static block + top-level `path` import; the later hardening scope restored the direct-execution boot guard)

### Database Changes

- None.

### API Changes

- Additive only: static GETs at `/api/v1/platform/branding-assets/<filename>` (public), `/api/v1/attendance/media/<filename>` (auth), `/api/v1/attachments/files/<filename>` (auth), `/api/v1/salary-slips/files/<filename>` (auth). Existing routes unchanged.

### Remaining Work

- None for the original static-file task. The later hardening scope restored `if (require.main === module)`, so importing `server.js` no longer boots the app and the integration suite runs normally.

### Verification

- [x] Frontend verified (no frontend changes)
- [x] Backend verified (static mounts + unit suite + integration suite + manual supertest checks)
- [x] API verified (branding 200/no-auth, attendance 401/200, attachments/salary gated 401/200, 404 ordering)
- [x] Database verified (no schema changes)
- [x] RBAC verified (attendance + attachments/salary static gated behind `authenticate`)
- [x] Regression checked (only `backend/server.js` modified; existing routes preserved via `fallthrough`)

---

## Absensi Report Location Enhancement

### Scope and Decision Record

The existing attendance schema stores GPS coordinates in
`clockInLocation`/`clockOutLocation`, but not a human-readable address. This
enhancement resolves those coordinates only when the Absensi report is
previewed/exported, caches successful results in MongoDB, and falls back to
formatted coordinates when resolution is unavailable.

BigDataCloud's free client endpoint was evaluated and rejected because its Fair
Use Policy does not allow server-side/batch reverse geocoding of stored
coordinates. Photon (`https://photon.komoot.io`) is the configured default;
the provider URL remains environment-configurable.

### LOC-FR-001: Add attendance report location columns

- [x] Add `clockInLocation` and `clockOutLocation` to the ATTENDANCE report
  registry and add Indonesian labels for both columns.

### LOC-FR-002: Pass stored coordinates through the attendance provider

- [x] Read valid latitude/longitude pairs from both attendance location fields
  without exposing unrelated verification metadata.

### LOC-FR-003: Add cached reverse geocoding

- [x] Add the `location_geocodes` model/repository and Photon reverse-geocoder
  with coordinate-key deduplication, timeout, fair-use interval, cache hits,
  and non-fatal failure handling.

### LOC-FR-004: Enrich preview and Excel report values

- [x] Resolve addresses for the current preview page and all Excel export rows;
  use six-decimal coordinates when an address cannot be resolved.

### LOC-FR-005: Wire configuration and preserve export behavior

- [x] Wire the geocoder through `server.js`, add `GEOCODING_*` configuration
  defaults, widen Excel location columns, and keep other report types and
  attendance documents unchanged.

### LOC-FR-006: Automated verification

- [x] Add/update unit and integration tests covering columns, cache hit/miss,
  Photon response formatting, duplicate coordinates, disabled/failed lookup,
  coordinate fallback, page-only preview enrichment, and Excel output.

### LOC-FR-007: Future-AI implementation documentation

- [x] Create `ai-project-context/ABSENSI-LOCATION.md` and cross-reference it
  from `project-context.md` so the coordinate-only storage and geocoding/cache
  behavior remain discoverable.

#### Developer Note

The original TODO above tracks the earlier Express static-file task. The
Absensi location enhancement is intentionally appended as a separate scope so
the completed static-file history is preserved. The current source of truth
for this enhancement is the attendance/report implementation plus
`ai-project-context/ABSENSI-LOCATION.md`.

#### Implementation Notes

- Location values are resolved by `ReportService.enrichLocations()` after the
  report provider returns rows. Preview enrichment runs after pagination so it
  only resolves the visible page; Excel export enrichment covers all rows.
- Successful Photon results are stored in the `location_geocodes` collection
  under a coordinate key rounded to four decimal places (~11 m). Existing attendance
  records are not changed.
- Photon public requests use `lang=default`, because the public instance does
  not accept `id`; local Indonesian names are still returned where available.
- A live Photon request was verified successfully with a Jakarta coordinate.
- Feature-specific report/geocoder tests pass. The later production-hardening
  scope restored the direct-execution boot guard, so the complete integration
  suite now runs without the Mongoose active-connection URI conflict.

## Location Enhancement Implementation Summary

### Completed

- LOC-FR-001 — Attendance preview/export location columns and labels.
- LOC-FR-002 — Coordinate extraction from clock-in/clock-out attendance data.
- LOC-FR-003 — Photon reverse geocoder with MongoDB cache, timeout, rate limit,
  deduplication, and graceful failure.
- LOC-FR-004 — Address enrichment with six-decimal coordinate fallback.
- LOC-FR-005 — Server/configuration wiring and readable Excel column widths.
- LOC-FR-006 — Feature-specific unit/integration test updates and new geocoder
  tests.
- LOC-FR-007 — `ai-project-context/ABSENSI-LOCATION.md` plus project-context
  cross-reference.

### Files Changed

- `backend/server.js`
- `backend/src/application/report.service.js`
- `backend/src/domain/report.js`
- `backend/src/infrastructure/config.js`
- `backend/src/infrastructure/exporters/excel.exporter.js`
- `backend/src/infrastructure/geocoding/reverse-geocoder.js`
- `backend/src/infrastructure/models/location-geocode.model.js`
- `backend/src/infrastructure/repositories/location-geocode.repository.js`
- `backend/src/infrastructure/report-providers.js`
- `backend/test/integration/reports.api.test.js`
- `backend/test/unit/report.domain.test.js`
- `backend/test/unit/report.exporter.test.js`
- `backend/test/unit/report.service.test.js`
- `backend/test/unit/reverse-geocoder.test.js`
- `frontend/src/lib/labels.ts`
- `ai-project-context/ABSENSI-LOCATION.md`
- `ai-project-context/project-context.md`
- `ai-project-context/TODO.md`

### Database Changes

- Added the `location_geocodes` cache model/collection.
- No attendance schema migration; historical attendance documents remain
  coordinate-only and are preserved.

### API Changes

- No new endpoints.
- ATTENDANCE report preview rows and Excel exports now include
  `clockInLocation` and `clockOutLocation` values.
- Other report types and existing report permissions/routes are unchanged.

### Remaining Work

- None in the location implementation.
- None in the location implementation. Production-hardening verification is
  recorded in the scope below.

### Verification

- [x] Feature-specific backend tests: 34/34 targeted tests passed.
- [x] Backend unit suite: 778 passed; 0 failures.
- [x] Frontend `npm run build` passed.
- [x] Frontend `npm run lint` passed.
- [x] Node syntax checks passed for changed backend files.
- [x] Live Photon reverse-geocoding request succeeded.
- [x] `git diff --check` passed.
- [x] Full integration suite: 131 passed; 0 failures.

---

## Absensi Report Production Hardening

This scope applies the pragmatic production hardening selected for the current
small deployment (approximately 300 users) while retaining the public Photon
service and its fair-use interval.

### HARDEN-FR-001: Improve geocode cache reuse

- [x] Round reverse-geocoding cache keys to four decimal places (approximately
  11 metres) while retaining six-decimal coordinate display fallbacks.

### HARDEN-FR-002: Bound queued geocoder work

- [x] Start each preview/export geocoding deadline when the request is enqueued,
  preventing a preview from waiting behind a long export and then receiving a
  fresh deadline.

### HARDEN-FR-003: Add non-sensitive geocoder failure visibility

- [x] Emit one batch warning for unresolved provider lookups with provider and
  counts only; employee coordinates and provider URLs are not logged.

### HARDEN-FR-004: Restore test-safe server startup and FR-037 behavior

- [x] Auto-start the backend only when `server.js` is executed directly, while
  preserving `npm start` behavior and allowing imported test apps to build.
- [x] Restore the intended human-readable leave summary (`ANNUAL cuti ...`)
  used by the self-service history surface.

### HARDEN-FR-005: Improve report preview readability and deterministic tests

- [x] Add a native tooltip containing the full value for truncated report-table
  cells, including long reverse-geocoded addresses.
- [x] Make report integration date filters independent of the day the suite is
  executed and reject schema-default null coordinates instead of rendering
  `0.000000, 0.000000`.

#### Hardening Implementation Notes

- Public Photon remains configured intentionally for the current small scale;
  `GEOCODING_MIN_INTERVAL_MS=1100` remains in force. A cold cache may show
  coordinate fallbacks until addresses are resolved and cached.
- No cache migration is required because the location feature has not been
  deployed with five-decimal keys; new keys use the four-decimal bucket.
- `backend/server.js` now uses `if (require.main === module)` around `start()`.
- `ReportTable.tsx` keeps truncation for layout safety and exposes the complete
  value through the browser tooltip.

#### Hardening Files Changed

- `backend/src/infrastructure/geocoding/reverse-geocoder.js`
- `backend/src/infrastructure/report-providers.js`
- `backend/src/application/request.service.js`
- `backend/server.js`
- `backend/test/unit/reverse-geocoder.test.js`
- `backend/test/unit/report.service.test.js`
- `backend/test/integration/reports.api.test.js`
- `frontend/src/features/reports/ReportTable.tsx`
- `ai-project-context/ABSENSI-LOCATION.md`
- `ai-project-context/project-context.md`
- `ai-project-context/TODO.md`

#### Hardening Verification

- [x] Reverse-geocoder tests: 10/10 passed.
- [x] Request-service tests: 14/14 passed, including FR-037.
- [x] Backend unit suite: 778/778 passed.
- [x] Backend integration suite: 131/131 passed.
- [x] Frontend build passed.
- [x] Frontend lint passed.
- [x] Backend syntax checks passed.

---

## Absensi Overview Name Search

### ATTENDANCE-SEARCH-FR-001: Search the employee filter by name

- [x] Replace the Absensi overview's employee ObjectId input with a name-only search.

### ATTENDANCE-SEARCH-FR-002: Search the department filter by name

- [x] Replace the Absensi overview's department ObjectId input with a name-only search using the same server-side text-search approach.

### ATTENDANCE-SEARCH-FR-003: Preserve safe filtering and compatibility

- [x] Resolve name searches on the backend, preserve legacy API query parameters, and return an empty result when no users match instead of accidentally returning all attendance records.

#### Implementation Notes

- `GET /api/v1/attendance` now accepts `employeeSearch` and `departmentSearch`.
- Employee searches reuse the existing User `$text` index across name, username, and email.
- Departments now have a `$text` index across name and code; matching department ids are resolved before users are filtered.
- The frontend fields are now `Nama karyawan` and `Departemen`; ObjectIds are no longer requested from HR users.
- Existing `employeeId` and `departmentId` API filters remain supported for backward compatibility, with `employeeId` retaining precedence when supplied.
- Zero resolved users now produce an empty page, fixing the existing empty-filter fall-through in `queryOverview`.

## Name Search Implementation Summary

### Completed

- ATTENDANCE-SEARCH-FR-001
- ATTENDANCE-SEARCH-FR-002
- ATTENDANCE-SEARCH-FR-003

### Files Changed

- `backend/server.js`
- `backend/src/application/attendance.service.js`
- `backend/src/infrastructure/models/department.model.js`
- `backend/src/infrastructure/repositories/org.repository.js`
- `backend/src/infrastructure/repositories/user.repository.js`
- `backend/src/presentation/dto/attendance.dto.js`
- `backend/test/helpers/fakes.js`
- `backend/test/unit/attendance.service.test.js`
- `backend/test/integration/attendance.api.test.js`
- `frontend/src/features/attendance/AttendanceOverview.tsx`
- `ai-project-context/TODO.md`

### Database Changes

- Added a Mongoose text index for department name/code search. No data migration is required.

### API Changes

- Added optional `employeeSearch` and `departmentSearch` query filters to the attendance overview endpoint.
- Existing `employeeId` and `departmentId` query filters remain supported.

### Remaining Work

- None for this name-search scope.

### Verification

- [x] Backend unit suite: 778/778 passed.
- [x] Backend integration suite: 131/131 passed.
- [x] Frontend lint passed.
- [x] Frontend production build passed.
- [x] Backend syntax checks and `git diff --check` passed.
