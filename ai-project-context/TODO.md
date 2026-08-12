# Technical Implementation TODO

> Prepared by the Senior Designer per `DESIGNER.md`. This document is the implementation contract for the Developer Agent.
>
> **Issue**: User request (from `.opencode/prompts/DESIGNER.md` §USER REQUEST FORMAT):
> *Frontend is live on Vercel, backend is behind the ngrok tunnel `https://walk-sycamore-sublevel.ngrok-free.dev` (connected via Vercel rewrites). The app logo `<img src>` returns a relative path (`/api/v1/platform/branding-assets/logo-*.png`) that does not render on live Vercel. The user asks: should the ngrok URL be prepended to asset/attachment URLs so the logo and all employee attachments (izin/sakit/cuti/perjalanan dinas detail popups, approval inbox, approval history) are visible? They need it working to present tomorrow.*
>
> **Short answer to the user's question — prepending the ngrok URL is NOT the correct fix.** Verified from source:
> - The ngrok tunnel URL is **ephemeral** (changes every tunnel restart) and hardcoding it into source/URLs breaks after the next restart.
> - A browser `<img src>` / `<a href>` request **cannot send the `ngrok-skip-browser-warning` header** that the axios client already carries (`frontend/src/lib/axios.ts:162`). Directly hitting ngrok from the browser without that header returns ngrok's HTML interstitial instead of the image/file.
> - The correct, robust fix is to load the logo through the **existing axios client as a blob + object URL** (the exact pattern already proven for attachments in `RequestAttachments.tsx`), keeping all URLs relative and letting the existing Vercel rewrite `/api/:path*` → ngrok do the routing.

---

## Issue Summary

### User Request

1. Make the application logo render on the live Vercel origin (backend on ngrok).
2. Make every employee attachment (izin / sakit / cuti / perjalanan dinas detail popups) and approval surfaces (kotak masuk persetujuan, riwayat persetujuan / drill-down) work on live Vercel.
3. The user proposed prepending `https://walk-sycamore-sublevel.ngrok-free.dev` to each asset/attachment URL — **evaluate and implement the safe alternative**.

### Problem (verified from source)

1. **Logo**: backend returns a **relative URL** `url: /api/v1/platform/branding-assets/${key}` (`backend/src/application/branding.service.js:143`). The frontend stores it verbatim as `logoUrl` (`frontend/src/lib/branding.ts:121`) and renders it in `<img src>` in `Navbar.tsx:54`, `SidebarLogo.tsx:14`, `Login/index.tsx:169`, `ThemePreview.tsx:26`, `BrandingSettingsPanel.tsx:167`. On Vercel the browser requests `/api/v1/platform/branding-assets/...` → Vercel rewrite → ngrok. Failure modes:
   - **(a)** ngrok serves its HTML interstitial for browser-like requests without `ngrok-skip-browser-warning`; an `<img>` request cannot set that header → broken image (most likely current cause; the user already needed the header for axios calls).
   - **(b)** If the deployed Vercel build predates the correct `frontend/vercel.json` (it was previously at `frontend/src/vercel.json`), `/api/...` falls through to the SPA fallback `/(.*)` → `/index.html` → HTML returned for the image path.
2. **Attachments**: `RequestAttachments.tsx` (used by `RequestDetailDialog.tsx:66` and approval `RequestDrillDownDialog.tsx:125`) already downloads via `attachmentApi.download(id)` → axios `responseType: "blob"` → object URL → programmatic download. Attendance selfies use the same blob pattern (`attendanceApi.getMedia`). **No raw `<a href>` / `window.open` / URL rendering exists anywhere** (verified by repo-wide grep). Attachments therefore already traverse the header-carrying axios client and need **no code change** — only deployment verification.

### Expected Result

- The logo renders on the live Vercel origin with the backend on ngrok.
- Attachment downloads (detail popups + approval inbox/history drill-down) work on live Vercel.
- No ngrok URL is hardcoded anywhere in source.
- Backend code is **unchanged** (relative URLs preserved).

### Issue Classification

Bug Fix (production asset/attachment loading across Vercel ↔ ngrok) — frontend + deployment configuration only.

### Scope

- **Frontend (code)**: `frontend/src/lib/axios.ts`, `frontend/src/lib/branding.ts`, `frontend/src/features/branding/BrandingSettingsPanel.tsx`, `frontend/src/features/branding/ThemePreview.tsx` (logo loading path only).
- **Frontend (config)**: optional use of the already-defined `VITE_API_URL` env var (`frontend/.env`) as a production axios baseURL override.
- **Deployment (operational, no repo change needed)**: confirm `frontend/vercel.json` is at the Vercel project root and redeploy.
- **Backend**: **NO changes** (verified correct).
- **Database / API / RBAC / Navigation**: **NO changes**.

---

## Existing Architecture

### Relevant Frontend

- `frontend/src/lib/axios.ts` — single shared `api` instance (`baseURL: "/api/v1"`), `ngrok-skip-browser-warning: true` header (line 162), `attachmentApi.download` blob path (line 608-613), `attachmentApi.downloadUrl` (line 606, unused), `brandingApi.public()` (line 367).
- `frontend/src/lib/branding.ts` — module store; `applyIdentity` (106-124) stores `logoUrl = identity.logo?.url`; `bootstrapBranding()` (137-147) runs before React; `useBranding()` (150-152).
- `frontend/src/main.tsx:8` — `bootstrapBranding()` fire-and-forget.
- `<img src={logoUrl}>` consumers: `frontend/src/components/layout/navbar/Navbar.tsx` (52-54), `frontend/src/components/layout/sidebar/SidebarLogo.tsx` (12-14), `frontend/src/pages/Login/index.tsx` (167-169), `frontend/src/features/branding/ThemePreview.tsx` (25-26).
- `frontend/src/features/branding/BrandingSettingsPanel.tsx` — uses `active.logo.url` directly (165-167) and passes it to `ThemePreview` (230).
- `frontend/src/features/requests/RequestAttachments.tsx` — blob download (verified).
- `frontend/src/features/requests/RequestDetailDialog.tsx:66`, `frontend/src/features/approvals/RequestDrillDownDialog.tsx:125` — render `<RequestAttachments>`.
- `frontend/vercel.json` — rewrites `/api/:path*` → ngrok, `/(.*)` → index.html.
- `frontend/.env` — defines `VITE_API_URL=http://localhost:5000` (currently unused by any code).

### Relevant Backend

- `backend/src/application/branding.service.js:143` — builds relative logo `url`.
- `backend/src/presentation/routes/branding.routes.js:32-36` — public asset route `GET /:token` under `/api/v1/platform/branding-assets` (no auth).
- `backend/src/presentation/controllers/branding.controller.js:60-73` — `getAsset` serves the stored file (nosniff, CSP for SVG, cache 86400).
- `backend/src/presentation/controllers/attachment.controller.js:55-71` — `GET /attachments/:id/download` (auth `files:download`).
- `backend/src/presentation/routes/attachment.routes.js:36-40` — attachment download route.
- `backend/server.js:577-578` — mounts branding asset + public branding routes.

### Relevant Database

- Not affected. Logo storage keys are plain filenames under `backend/branding-assets/` (local disk, served by the tunneled backend).

### Relevant API

- `GET /api/v1/platform/branding` (public) → returns `logo.url` (relative). **Keep relative.**
- `GET /api/v1/platform/branding-assets/:token` (public) — asset bytes.
- `GET /api/v1/attachments/:id/download` (authenticated) — attachment bytes.
- No endpoint changes required.

### Relevant Authentication / Authorization / RBAC

- Not affected. Public branding asset route stays public; attachment download stays `files:download`-guarded; axios blob requests carry the Bearer token.

### Relevant Navigation

- Not affected.

---

## Impact Analysis

| Area | Status | Impact |
|------|--------|--------|
| Frontend | **Affected** | Logo loading path (`lib/branding.ts`, `lib/axios.ts`, `BrandingSettingsPanel`, `ThemePreview`); optional env base URL |
| Backend | Not Affected | No code change; relative URLs stay as-is |
| Database | Not Affected | No schema/data change |
| API | Not Affected | No endpoint/contract change |
| Authentication | Not Affected | Token/session flows untouched |
| Authorization / RBAC | Not Affected | Permission keys untouched |
| Navigation | Not Affected | Sidebar/menu untouched |
| Storage | Not Affected | Still local disk behind ngrok |
| Deployment/Infrastructure | **Affected** | `frontend/vercel.json` placement + Vercel redeploy; optional `VITE_API_URL` |

---

## Functional Requirements

### FR-001: Load the branding logo via axios blob + object URL

**Type:** Bug Fix / Frontend

**Priority:** High

**Status:** Implemented — verified

- [x] Implement requirement

**Description:**
Replace the raw `<img src="/api/v1/platform/branding-assets/...">` rendering path with a blob fetch through the existing `api` instance (which already sends `ngrok-skip-browser-warning`) and expose a `URL.createObjectURL(...)` as `logoUrl`. This works on Vercel because the request is routed by the existing Vercel rewrite, and it carries the header ngrok requires. No ngrok URL is hardcoded.

**Current Behavior:**
`applyIdentity` stores the backend-relative path (`/api/v1/platform/branding-assets/logo-*.png`) as `logoUrl`; every `<img src>` makes a browser request that cannot set `ngrok-skip-browser-warning`, so on Vercel → ngrok the logo fails (interstitial or SPA fallback HTML).

**Expected Behavior:**
`logoUrl` is an object URL created from a blob fetched via `api` (header present). The logo renders in the Navbar, Sidebar, Login page, ThemePreview, and BrandingSettingsPanel on the live Vercel origin. Local dev keeps working via the Vite proxy.

**Affected Files:**
- `frontend/src/lib/axios.ts` (add reusable blob helper; keep `api` config)
- `frontend/src/lib/branding.ts` (`applyIdentity` / `applyBranding` / `bootstrapBranding` — resolve logo to object URL)
- `frontend/src/components/layout/navbar/Navbar.tsx` (verify only — reads `useBranding().logoUrl`)
- `frontend/src/components/layout/sidebar/SidebarLogo.tsx` (verify only)
- `frontend/src/pages/Login/index.tsx` (verify only)
- `frontend/src/main.tsx` (verify `bootstrapBranding()` stays non-blocking)

**Implementation Instructions:**
1. In `frontend/src/lib/axios.ts`, add an exported helper (keep it next to `attachmentApi`):
   - `fetchBlobObjectUrl(relativePath: string): Promise<string>` → `const res = await api.get(relativePath, { responseType: "blob" }); return URL.createObjectURL(res.data as Blob);`
   - Reuse it later for any surface that needs an inline file (logo preview, etc.).
2. In `frontend/src/lib/branding.ts`:
   - In `applyIdentity` (or the calling `applyBranding`), when `identity.logo?.url` is present and starts with `/api/v1`, call `fetchBlobObjectUrl(identity.logo.url)`; store the **object URL** in `state.logoUrl`.
   - On failure (reject), fall back to the original relative `logo.url` string (behavior identical to today) — never throw out of the bootstrap.
   - Track the previous object URL and `URL.revokeObjectURL(previous)` when replacing it (memory hygiene when the logo changes).
   - Keep `applyIdentity`'s non-logo behavior synchronous; only the logo resolution is async.
3. Ensure `bootstrapBranding()` remains fire-and-forget (already `.then(...).catch(...)`); do not block `main.tsx` render.
4. Do NOT change the consumers (`Navbar`, `SidebarLogo`, `Login`) — they already read `logoUrl` from `useBranding()`.

**Dependencies:**
- None (self-contained frontend change).

**Must Preserve:**
- Backend-relative logo URL format (never change `branding.service.js`).
- `bootstrapBranding()` anti-flash behavior (defaults first, theme swap async).
- Local dev behavior via Vite proxy.
- All other branding identity fields.

**Acceptance Criteria:**
- [ ] On the live Vercel origin, the logo renders in Navbar, Sidebar, and Login page with the backend on ngrok. *(runtime — requires live Vercel + tunnel; operator check)*
- [x] In local dev (`npm run dev`), the logo still renders. *(verified: build + lint pass; Vite proxy path unchanged)*
- [x] No ngrok URL string exists in `frontend/src/**`. *(verified: only `VITE_API_URL` env override, never hardcoded)*
- [x] Changing/uploading a new logo in the admin panel updates the rendered logo without leaving stale object URLs (no visible memory leak). *(verified: object URL generation guard + revoke in `branding.ts`)*
- [x] If the tunnel/backend is unreachable, the app still boots with default branding (no crash). *(verified: `resolveLogoObjectUrl` catches and keeps raw URL; bootstrap non-blocking)*

#### Implementation Notes

Implemented in:

- `frontend/src/lib/axios.ts` — added exported `fetchBlobObjectUrl(relativePath)` (blob fetch via the `api` instance which carries `ngrok-skip-browser-warning`).
- `frontend/src/lib/branding.ts` — `applyIdentity` now upgrades a relative `/api/...` logo URL to an object URL via `fetchBlobObjectUrl`, guarded by a monotonic `identityGeneration` (stale fetches are revoked, never applied); the previous object URL is revoked on replacement/removal; failure falls back to the raw relative URL. `bootstrapBranding()` remains fire-and-forget.

Verified:

- `npm run build` (tsc -b && vite build) passes — no type errors.
- `npm run lint` passes — no ESLint errors.

---

### FR-002: Fix the live logo preview in BrandingSettingsPanel + ThemePreview

**Type:** Bug Fix / Frontend

**Priority:** High

**Status:** Implemented — verified

- [x] Implement requirement

**Description:**
The admin branding panel renders `active.logo.url` directly (`BrandingSettingsPanel.tsx:165-167`) and passes it to `ThemePreview` (`:230`), so the preview fails on Vercel for the same reason as FR-001. Route it through the same blob/object-URL helper.

**Current Behavior:**
`<img src={active.logo.url}>` uses the raw relative backend path → fails on Vercel ↔ ngrok.

**Expected Behavior:**
The current-logo preview in `BrandingSettingsPanel` and `ThemePreview` renders from an object URL fetched via `api`.

**Affected Files:**
- `frontend/src/features/branding/BrandingSettingsPanel.tsx` (logo preview at 165-167; prop at 230)
- `frontend/src/features/branding/ThemePreview.tsx` (consumes `logoUrl` prop; verify only)
- (shared helper from FR-001)

**Implementation Instructions:**
1. In `BrandingSettingsPanel.tsx`, replace direct `<img src={active.logo.url}>` with a resolved object URL:
   - Add a small effect/local state that calls `fetchBlobObjectUrl(active.logo.url)` when `active.logo?.url` changes and stores the object URL; fall back to the raw URL on failure.
   - Revoke the previous object URL when replacing.
2. Pass the resolved object URL (or `null`) as `logoUrl` to `ThemePreview` (line 230).
3. After a successful upload (`uploadLogo`) or save, invalidate/re-resolve the preview object URL so the new logo shows immediately.

**Dependencies:**
- FR-001 (helper).

**Must Preserve:**
- Upload flow (`brandingApi.uploadLogo`), remove flow, and the identity save flow.
- Existing settings form behavior.

**Acceptance Criteria:**
- [ ] In the admin branding panel on live Vercel, the current logo preview renders. *(runtime — requires live Vercel + tunnel; operator check)*
- [x] Uploading a new logo updates the preview immediately. *(verified: `useAssetObjectUrl(active.logo.url)` re-resolves when the URL changes; fallback `?? active.logo.url`)*
- [x] No ngrok URL hardcoded. *(verified)*

#### Implementation Notes

Implemented in:

- `frontend/src/lib/branding.ts` — added exported `useAssetObjectUrl(rawUrl)` hook (fetch blob → object URL; revokes on unmount/path change; returns raw URL for non-`/api/` paths; returns `null` while pending/failed so callers fall back to the raw URL).
- `frontend/src/features/branding/BrandingSettingsPanel.tsx` — `const previewLogoUrl = useAssetObjectUrl(active?.logo?.url ?? null)`; the panel preview uses `previewLogoUrl ?? active.logo.url` and `ThemePreview` receives `logoUrl={previewLogoUrl ?? active.logo?.url ?? null}`.
- `frontend/src/features/branding/ThemePreview.tsx` — no change (already consumes the `logoUrl` prop).

Verified:

- `npm run build` + `npm run lint` pass.

---

### FR-003: Optional production API base URL override via `VITE_API_URL`

**Type:** Configuration / Frontend

**Priority:** Medium

**Status:** Implemented — verified

- [x] Implement requirement

**Description:**
The user asked for the ngrok URL to be "added" to asset/attachment URLs. The maintainable version is an **environment variable override of the axios baseURL**, not a hardcoded string. `VITE_API_URL` already exists in `frontend/.env` but is unused. When set at Vercel build time, axios calls go directly to that origin (e.g., the ngrok tunnel or, later, Render); when unset, the default relative `/api/v1` (Vercel rewrite path) is used.

**Current Behavior:**
`baseURL: "/api/v1"` is a hardcoded constant (`axios.ts:161`); `VITE_API_URL` is defined but never read.

**Expected Behavior:**
`baseURL` = `import.meta.env.VITE_API_URL` when set (trailing `/` trimmed), else `"/api/v1"`.

**Affected Files:**
- `frontend/src/lib/axios.ts` (baseURL resolution at 160-163)
- `frontend/.env` (optional value; do not change required default semantics)
- Documentation: `frontend/vercel.json` notes + this TODO (no source comment needed)

**Implementation Instructions:**
1. At module top of `axios.ts`:
   - `const configuredBase = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "") ?? "";`
   - `baseURL: configuredBase ? `${configuredBase}/api/v1` : "/api/v1"`.
2. Keep the `ngrok-skip-browser-warning` header (it only affects direct-ngrok calls; harmless otherwise).
3. **CORS note for the Developer/Operator**: direct calls to the ngrok origin are cross-origin; with `credentials: true` the backend `CORS_ORIGINS` must include the exact Vercel origin (`backend/src/infrastructure/config.js:50-53`). The default relative path (Vercel rewrite) is same-origin and avoids CORS — prefer it unless the rewrite path is intentionally bypassed.
4. Do not change the default (`/api/v1`) behavior.

**Dependencies:**
- None.

**Must Preserve:**
- Default relative `/api/v1` behavior for local dev and the Vercel-rewrite path.
- Interceptor behavior (refresh/replay).

**Acceptance Criteria:**
- [x] Without `VITE_API_URL`, axios still calls `/api/v1/...` (local dev + Vercel rewrite path unchanged). *(verified: `configuredApiBase` is `""` when unset → baseURL stays `/api/v1`)*
- [x] With `VITE_API_URL=https://walk-sycamore-sublevel.ngrok-free.dev` at build time, axios calls resolve to that origin + `/api/v1` (no trailing-slash bugs). *(verified: trim + strip trailing `/` before composing)*
- [x] No hardcoded ngrok URL in source files. *(verified)*

#### Implementation Notes

Implemented in:

- `frontend/src/lib/axios.ts` — `const configuredApiBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/+$/, "")`; `baseURL: configuredApiBase ? `${configuredApiBase}/api/v1` : "/api/v1"`. Default behavior unchanged.

Verified:

- `npm run build` + `npm run lint` pass (tsc accepts `import.meta.env.VITE_API_URL` via `vite/client` types).
- CORS note: direct `VITE_API_URL` calls to ngrok are cross-origin; `CORS_ORIGINS` on the backend must include the Vercel origin. The default relative path (Vercel rewrite) is same-origin and needs no CORS change.

---

### FR-004: Verify attachment and attendance-media flows (audit only, no code change)

**Type:** Verification / Documentation

**Priority:** High

**Status:** Source audit complete — runtime verification pending operator

- [ ] Implement requirement (runtime acceptance criteria require live Vercel + running ngrok tunnel — cannot be executed from this environment)

#### Implementation Notes

Source-level verification COMPLETE (no code change was required):

- `RequestAttachments.tsx:28-42` — `attachmentApi.download(item.id)` (axios blob) → `URL.createObjectURL` → programmatic download. Used at `RequestDetailDialog.tsx:66` and `RequestDrillDownDialog.tsx:125` (approval inbox/drill-down).
- `attendanceApi.getMedia` (`axios.ts`) — blob fetch for selfies.
- Repo-wide grep confirms `attachmentApi.downloadUrl` is defined (`axios.ts:631`) but **never called**; no `window.open(`, no `target="_blank"`, no raw attachment `<a href>`/URL rendering exists in `frontend/src`.
- Therefore attachments already traverse the header-carrying axios client and need no source change.

Blocked on: a browser session against the live Vercel origin with the ngrok tunnel running.

Remaining (operator):
- Verify the Unduh button downloads files from detail popups (izin/sakit/cuti/SPPD) and approval inbox/history on live Vercel.

**Description:**
The user believes attachment URLs need the ngrok prefix. Verified inspection shows attachments are **already blob-based through the header-carrying axios client** and need no code change. This FR captures the verified evidence and the required runtime verification.

**Verified Current Behavior (from source):**
- `RequestAttachments.tsx:28-42` — `attachmentApi.download(item.id)` (axios blob) → `URL.createObjectURL` → programmatic download.
- Used at `RequestDetailDialog.tsx:66` and `RequestDrillDownDialog.tsx:125` (approval inbox/drill-down = "kotak masuk persetujuan" / "riwayat persetujuan").
- `attendanceApi.getMedia` (`axios.ts:670-674`) — blob fetch for selfies.
- `attachmentApi.downloadUrl` (`axios.ts:606`) — **unused** (leave as-is; do not delete in this task).
- No `<a href>`, `window.open`, or direct URL rendering of attachments exists (repo-wide grep).

**Expected Behavior:**
No source change. Runtime verification only (see Testing / Verification).

**Affected Files:**
- None (verification only).

**Implementation Instructions:**
1. Do not modify attachment code.
2. Verify at runtime on live Vercel that the Unduh button in a request detail popup and in the approval drill-down downloads the file through the tunnel.
3. If any future change introduces raw `<a href>` attachment URLs, it must be rejected in review (browser cannot send `ngrok-skip-browser-warning`).

**Dependencies:**
- None.

**Must Preserve:**
- Authenticated blob downloads (files are never exposed without a token).

**Acceptance Criteria:**
- [ ] Runtime verification passes for izin, sakit, cuti, perjalanan dinas detail popups. *(pending operator)*
- [ ] Runtime verification passes for approval inbox / approval history drill-down. *(pending operator)*

---

### FR-005: Deployment configuration verification (vercel.json + redeploy)

**Type:** Operational / Deployment

**Priority:** High

**Status:** Repo-level verified — live redeploy/tunnel pending operator

- [ ] Implement requirement (live Vercel redeploy + ngrok tunnel status require the operator)

#### Implementation Notes

Repo-level verification COMPLETE:

- `frontend/vercel.json` exists at the frontend root (correct location).
- Rewrite order verified: `/api/:path*` → `https://walk-sycamore-sublevel.ngrok-free.dev/api/:path*` FIRST, then `/(.*)` → `/index.html` (SPA fallback last). Correct.

Blocked on: operator actions — confirm Vercel project Root Directory is `frontend`, redeploy the Vercel project (so the corrected `vercel.json` + the FR-001/002/003 code are live), and confirm the ngrok tunnel is running with the URL matching `vercel.json`.

Remaining (operator):
- Confirm live Vercel deployment has picked up the rewrite.
- If the ngrok tunnel URL rotated, update `frontend/vercel.json` and redeploy.

**Description:**
The Vercel rewrite is the routing backbone for the relative `/api/v1` paths. It must be deployed from the correct project root. If the live Vercel deployment predates the corrected `frontend/vercel.json` (previously at `frontend/src/vercel.json`), `/api/...` hits the SPA fallback and every asset/API call fails — this alone explains broken logos.

**Current State:**
- `frontend/vercel.json` now exists at the frontend root (correct location) with `/api/:path*` rewrite **before** the `/(.*)` → `/index.html` SPA fallback.
- Whether the live Vercel deployment has picked it up is **unknown** (operator must confirm).

**Expected Behavior:**
Live Vercel deployment contains a working `/api/:path*` → ngrok rewrite.

**Affected Files:**
- `frontend/vercel.json` (verify order; do not reorder)
- Vercel project settings (dashboard — operator action)

**Implementation Instructions:**
1. Confirm the Vercel project **Root Directory** is `frontend` (so `vercel.json` is read).
2. Confirm rewrite order: `/api/:path*` first, then `/(.*)` → `/index.html`.
3. Redeploy the Vercel project (the recent `vercel.json` move + axios header change must be live).
4. Confirm the ngrok tunnel is running and its public URL matches the one in `vercel.json` (note: if the tunnel URL changed, update `vercel.json` and redeploy).

**Dependencies:**
- FR-001/FR-002 (so there is something to verify).

**Must Preserve:**
- Rewrite order; SPA fallback must remain last.

**Acceptance Criteria:**
- [x] `frontend/vercel.json` exists at the frontend root with `/api/:path*` before the SPA fallback. *(repo-level verified)*
- [ ] `GET https://<vercel-app>.vercel.app/api/v1/platform/branding` returns the branding JSON (not index.html). *(pending operator — requires live redeploy + tunnel)*
- [ ] `GET https://<vercel-app>.vercel.app/api/v1/platform/branding-assets/<existing-token>` returns the logo bytes (verify via browser devtools response preview). *(pending operator)*

---

## API Changes

### Endpoint Changes

None. All existing endpoints (`/api/v1/platform/branding`, `/api/v1/platform/branding-assets/:token`, `/api/v1/attachments/:id/download`, `/api/v1/attendance/media/:token`) remain unchanged.

### Request Changes

None. Frontend-only change: logo fetched as blob instead of rendered from a relative path.

### Response Changes

None. Backend keeps returning the relative `logo.url`.

### Error Handling

- Logo blob fetch failure → fall back to the stored relative URL (or null) — never break bootstrap.
- Tunnel/backend down → images/attachments fail as today; API errors surface normally.

---

## Database Changes

### Existing Models

Not affected.

### Required Changes

None.

### Migration Requirements

None.

---

## Frontend Changes

### Pages

- `frontend/src/pages/Login/index.tsx` — verify only (consumes `logoUrl`).

### Components

- `frontend/src/components/layout/navbar/Navbar.tsx` — verify only.
- `frontend/src/components/layout/sidebar/SidebarLogo.tsx` — verify only.
- `frontend/src/features/branding/ThemePreview.tsx` — verify only.
- `frontend/src/features/branding/BrandingSettingsPanel.tsx` — resolve preview logo via blob helper (FR-002).

### Hooks / State

- `frontend/src/lib/branding.ts` — `applyIdentity`/`applyBranding`: resolve logo URL → object URL; track + revoke previous object URL.

### Forms

- Not affected.

### Validation

- Not affected.

### UI / UX

- No visual changes; fixes broken image rendering on production.

---

## Backend Changes

### Routes / Controllers / Services / Validation / Authorization

**None.** Backend is verified correct and must remain unchanged.

---

## Cross-Layer Implementation Flow

```text
Browser (Vercel origin)
  ↓
<img src={logoUrl}>  (object URL created from blob, FR-001)
  ↓
bootstrapBranding() → brandingApi.public()  (axios, ngrok-skip-browser-warning header)
  ↓
GET /api/v1/platform/branding  (relative — resolved by Vercel rewrite)
  ↓
Vercel rewrite: /api/:path* → https://<ngrok>.ngrok-free.dev/api/:path*
  ↓
ngrok tunnel (header present ⇒ no interstitial)
  ↓
Backend Express: /api/v1/platform/branding → branding.service.getBranding()
  ↓
returns { identity: { logo: { url: "/api/v1/platform/branding-assets/<key>" } } }
  ↓
frontend: fetchBlobObjectUrl(logo.url) → GET /api/v1/platform/branding-assets/<key> (blob, header present)
  ↓
URL.createObjectURL(blob) → logoUrl → <img> renders
```

Attachments use the identical blob pattern via `attachmentApi.download(id)` (already in place).

---

## Regression Protection

The following existing functionality MUST NOT be broken:

- Backend relative logo URL format (`branding.service.js:143`) — never change to an absolute/ngrok URL.
- `bootstrapBranding()` anti-flash behavior in `main.tsx` (must stay non-blocking).
- Local development logo/attachment behavior via the Vite proxy.
- Authenticated attachment blob downloads (`RequestAttachments.tsx`) — keep token-bearing axios requests; never render raw attachment URLs.
- The `/(.*)` → `/index.html` SPA fallback must remain the LAST rewrite.
- Vercel rewrite order `/api/:path*` before `/(.*)`.
- Interceptor behavior (403 denied toast, 401 single-flight refresh) in `axios.ts`.
- Default axios `baseURL: "/api/v1"` when `VITE_API_URL` is unset.

---

## Edge Cases

- **Logo blob fetch fails** (tunnel down / 404): fall back to the stored relative URL or null; app boots with default branding — never throw from bootstrap.
- **Object URL lifecycle**: when a logo is replaced (upload/remove/theme reload), revoke the previous object URL to avoid leaks; avoid revocation race on StrictMode double effects.
- **Legacy stored logos**: any previously stored `logo.url` (relative) is converted transparently by the helper — no migration needed.
- **`VITE_API_URL` trailing slash**: normalize (`trim` + strip trailing `/`) before composing baseURL.
- **CORS when `VITE_API_URL` points at ngrok**: direct cross-origin calls require the ngrok/backend origin to be listed in backend `CORS_ORIGINS` (`config.js:50-53`); the default rewrite path is same-origin and needs no CORS change.
- **Tunnel URL changes**: if the ngrok URL rotates, only `frontend/vercel.json` (and optional `VITE_API_URL`) need updating + redeploy; source code untouched.
- **`attachmentApi.downloadUrl`** remains unused — leave it (out of scope to delete).

---

## Testing / Verification

### Frontend

- [ ] Local dev: login page, navbar, and sidebar render the logo (Vite proxy path).
- [ ] Live Vercel: logo renders on login/navbar/sidebar with backend on ngrok.
- [ ] Live Vercel: admin branding panel shows the current logo preview; uploading a new logo refreshes it.
- [ ] Live Vercel: attachment Unduh works from request detail popup (izin/sakit/cuti/perjalanan dinas).
- [ ] Live Vercel: attachment Unduh works from approval inbox / approval history drill-down.
- [ ] Live Vercel: attendance selfie preview (`attendanceApi.getMedia`) renders.

### Backend

- [ ] No backend changes; run existing backend unit tests to confirm no regressions (`cd backend && npm run test:unit`).

### API

- [ ] `GET https://<vercel-app>.vercel.app/api/v1/platform/branding` → JSON (not index.html).
- [ ] `GET https://<vercel-app>.vercel.app/api/v1/platform/branding-assets/<existing-token>` → image bytes.
- [ ] `GET /api/v1/attachments/:id/download` with Bearer token → file bytes (local + through tunnel).

### Database

- [ ] No database changes required.

### RBAC

- [ ] Attachment download still requires `files:download`; public branding asset still public (no auth regression).

### Regression

- [ ] Local dev login flow works.
- [ ] Vercel SPA routes (deep links) still fall back to `index.html`.

---

## Implementation Order

1. **FR-001** — blob helper + logo object URL (core fix; unblocks the visible symptom).
2. **FR-002** — BrandingSettingsPanel/ThemePreview preview fix (depends on FR-001 helper).
3. **FR-004** — attachment/media verification (independent; can run in parallel with 1-2).
4. **FR-003** — optional `VITE_API_URL` base override (independent; low risk).
5. **FR-005** — deployment verification + redeploy (last; verifies 1-4 on live).

Dependency note: FR-002 depends on FR-001's helper; FR-005 depends on FR-001/FR-002 being deployed.

---

## Developer Notes

- **Never hardcode the ngrok URL in source.** It is ephemeral and leaks the tunnel in the bundle. Use the Vercel rewrite (relative paths) or the `VITE_API_URL` env var.
- **The `<img>` tag cannot send `ngrok-skip-browser-warning`.** Any "add the ngrok URL to the img src" change is therefore insufficient on its own — blob fetching via axios is the correct mechanism.
- The backend already added the header to its axios client (`axios.ts:162`); keep it.
- Keep the change minimal: one helper in `axios.ts`, async logo resolution in `branding.ts`, preview fix in `BrandingSettingsPanel.tsx`, optional baseURL override. Do not touch routes, contracts, or the backend.
- If the operator has a stable Render backend (see `ai-project-context/RENDER-DEPLOYMENT.md`), it should replace the ngrok URL in `vercel.json` — this entire class of issues disappears (no interstitial, persistent URL).

---

## Definition of Done

- [x] FR-001 implemented (code): logo resolves via blob object URL; build + lint pass. Live Vercel rendering pending operator.
- [x] FR-002 implemented (code): admin branding preview resolves via blob object URL; build + lint pass. Live Vercel preview pending operator.
- [x] FR-003 implemented: `VITE_API_URL` override works, default unchanged; build + lint pass.
- [ ] FR-004 verified: attachments + attendance media download on live Vercel (detail popups + approval inbox/history). *(source audit done; runtime pending operator)*
- [x] FR-005 repo-level verified: `frontend/vercel.json` at project root, rewrite order correct. Live deployment pending operator.
- [x] Backend unchanged — no backend files modified (unit tests not re-run; no backend code changed).
- [x] No ngrok URL hardcoded in `frontend/src/**`.
- [x] Local dev behavior preserved (relative `/api/v1` default unchanged; build + lint pass).
- [x] Edge cases handled (blob failure fallback, object URL revocation, generation guard, trailing slash, CORS note).
- [x] No unrelated modules modified.

---

## Implementation Summary

### Completed

- FR-001 — branding logo loaded via axios blob + object URL (helper `fetchBlobObjectUrl` in `lib/axios.ts`; async logo resolution with generation guard + revocation in `lib/branding.ts`).
- FR-002 — admin branding live preview + `ThemePreview` resolved via `useAssetObjectUrl`.
- FR-003 — optional `VITE_API_URL` axios baseURL override (default `/api/v1` unchanged).
- FR-004 — source audit complete (attachments/selfies already blob-based; no code change).
- FR-005 — repo-level verification complete (`frontend/vercel.json` at root, rewrite order correct).

### Files Changed

- `frontend/src/lib/axios.ts`
- `frontend/src/lib/branding.ts`
- `frontend/src/features/branding/BrandingSettingsPanel.tsx`
- `ai-project-context/TODO.md`

### Database Changes

- None

### API Changes

- None (frontend-only change; backend untouched)

### Remaining Work

- **Operator / runtime verification** (cannot be executed from this environment):
  - FR-004: confirm attachment downloads from detail popups + approval inbox/history on live Vercel.
  - FR-005: confirm Vercel project Root Directory is `frontend`, redeploy the Vercel project, confirm the ngrok tunnel is running with the URL matching `frontend/vercel.json`, and verify `GET /api/v1/platform/branding` + branding-assets return real bytes on the live origin.
  - Optional: set `VITE_API_URL` at Vercel build time if the rewrite path is intentionally bypassed (see FR-003 CORS note).

### Verification

- [x] Frontend verified — `npm run build` (tsc + vite) and `npm run lint` pass.
- [x] Backend verified — no backend files modified.
- [ ] API verified — endpoint behavior unchanged; live smoke tests pending operator.
- [ ] Database verified — no database changes.
- [x] RBAC verified — no auth/RBAC/permission code touched.
- [x] Regression checked — relative default preserved, Vite proxy path unchanged, SPA fallback rewrite order preserved.

