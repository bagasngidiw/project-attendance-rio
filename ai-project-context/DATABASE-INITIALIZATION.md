# MongoDB Production Database

> Provisioned and verified against the existing application architecture.
> No schemas, models, repositories, or authentication/RBAC logic were modified.
> No secrets are documented in this file.

## Database

- **Name:** `attendance_db`
- **Cluster:** `hris-project` (MongoDB Atlas)
- **Connection:** supplied through the `MONGO_URI` environment variable
  (`backend/.env`). The connection string database path is `/attendance_db`.
  The value itself is never printed or committed.

## Collections

Every collection below is defined by an existing Mongoose model under
`backend/src/infrastructure/models/` and is created automatically by the
application (MongoDB creates a collection on first write; the idempotent seed
creates the access-control collections on boot). The collection name is the
Mongoose model name lowercased (e.g. `RolePermission` → `role_permissions`).

| Collection | Source model | Purpose | Important relationships / indexes |
|---|---|---|---|
| `users` | `user.model.js` | Employee/admin accounts: identity, `passwordHash`, `status`, `tokenVersion`, lockout bookkeeping, denormalized `roleIds` mirror | Unique `username`, unique `email`; text index on name/username/email; `departmentId`, `positionId`, `managerId` refs |
| `roles` | `role.model.js` | Role definitions: `key`, `name`, `level`, `dataScope`, `status`, optimistic `version` | Unique `key`; seeded roles `SUPER_ADMIN` (always), `EMPLOYEE`/`MANAGER`/`HR_ADMIN` (when demo data enabled) |
| `permissions` | `permission.model.js` | Registered capability registry (`module:action` keys) | Unique `key`; `module` index; 71 permissions seeded from `domain/permissions.js` |
| `role_permissions` | `role-permission.model.js` | N–M join: Role → Permission | Unique `{roleId, permissionKey}`; `roleId` index |
| `user_roles` | `user-role.model.js` | N–M join: User → Role (source of truth for memberships) | Unique `{userId, roleId}`; `userId` + `roleId` indexes |
| `sessions` | `session.model.js` | Server-side session records for JWT validity, inactivity, revocation | Unique `sessionId`; `userId` index; TTL on `expiresAt` |
| `refresh_tokens` | `refresh-token.model.js` | Opaque refresh-token hashes with rotation + reuse detection | Unique `tokenHash`; `userId`/`sessionId`/`familyId` indexes; TTL on `expiresAt` |
| `audit_events` | `audit-event.model.js` | Append-only tamper-evident audit trail (login, RBAC, approvals) | Hash chain fields `prevHash`/`hash` |
| `outboxes` | `outbox.model.js` | Audit capture pipeline outbox | — |
| `activity_logs` | `activity-log.model.js` | Activity log projection | — |
| `approval_configurations` | `approval-configuration.model.js` | Per-request-type eligible approver roles/levels | Unique per request type; seeded defaults |
| `leave_types` / `sickness_types` | `leave-type.model.js` / `sickness-type.model.js` | System master data for leave/sickness requests | Seeded when demo data enabled |
| `requests`, `attendances`, `notifications`, `delegations`, `escalations`, `departments`, `positions`, `attachments`, `leave_balances`, `cutoff_rules`, `routing_rules`, `holidays`, `exception_reviews`, `reporting_histories`, `retention_jobs`, `filter_presets`, `mfa`, `recovery_tokens`, `overtime_corrections`, `attendance_corrections`, `role_templates`, `platform_settings` | respective models | Operational/business data | Created automatically on first use |

Note: the actual collection names were verified live on the cluster (28
collections present in `attendance_db`), not assumed from model names.

## Authentication

Login dependency order (collections touched by `POST /api/v1/auth/signin`):

1. `users` — lookup by username, lockout check, `status === "ACTIVE"` check,
   bcrypt password verification (`passwordHash`).
2. `user_roles` — resolve the user's role ids.
3. `roles` — resolve role keys.
4. `permissions` + `role_permissions` — compute effective permissions (union
   across ACTIVE roles).
5. `sessions` — open a session record (JWT-bound, inactivity tracked).
6. `refresh_tokens` — issue the rotating refresh token (family for reuse
   detection).
7. `audit_events` — record `AUTH.SIGNIN_SUCCESS` / failures.

Every protected request: `authenticate` verifies the JWT (signature,
issuer/audience/expiry), loads the user from `users`, checks
`user.tokenVersion === payload.ver`, validates the session in `sessions`
(revoked/expired/inactivity), then `authorize(...)` evaluates the required
permission keys against the token claims.

## RBAC

Actual implementation (reused as-is, nothing invented):

```text
User  --user_roles-->  Role  --role_permissions-->  Permission
(users.roleIds mirror keeps the user doc self-describing)
```

- Effective permissions = **union** of permission keys across all **ACTIVE**
  assigned roles (`rbac.service.js`).
- Role attributes: `key`, `name`, `level` (numeric hierarchy), `dataScope`
  (SELF / DIRECT_SUBORDINATES / DEPARTMENT / ALL_EMPLOYEES), `status`.
- Seeded roles: `SUPER_ADMIN` (level 100, ALL_EMPLOYEES, all permissions),
  `HR_ADMIN` (80), `MANAGER` (50), `EMPLOYEE` (10).
- Permissions are stored in the `permissions` registry and **assigned through
  the `role_permissions` join** — never embedded on users.
- Backend authorization: route-level `authorize(...keys)` + service-level
  re-checks. Frontend permission gating mirrors the registry via
  `contracts/permissions.ts` (kept in sync manually).

## SuperAdmin

- Initialized exclusively by the existing idempotent seed
  (`backend/src/infrastructure/seed/seed.js`) using environment variables:
  `SEED_SUPER_ADMIN_USERNAME`, `SEED_SUPER_ADMIN_EMAIL`,
  `SEED_SUPER_ADMIN_PASSWORD`, `SEED_DEMO_DATA`.
- The SUPER_ADMIN role (with every registered permission) is always ensured;
  the superadmin user is created only when missing, and role membership is
  always ensured (`user_roles` + `users.roleIds`).
- **Password policy (verified behavior):** the seed sets the password hash
  only when the user is first created; it never overwrites an existing user's
  password. If `SEED_SUPER_ADMIN_PASSWORD` is changed after creation, the
  stored hash must be rotated (see "Verification" below for how this was done
  with the application's own hasher).
- No password is documented, printed, or committed here.

## Seed Process

- Mechanism: `seedDatabase(...)` in `backend/src/infrastructure/seed/seed.js`,
  invoked on every server boot via `backend/server.js` `start()`.
- Steps: sync permission registry (71 keys) → upsert roles (SUPER_ADMIN
  always; others when `SEED_DEMO_DATA !== false`) → assign role→permission
  joins → ensure SUPER_ADMIN user + membership → (demo data only) provision
  demo users, approval configs, system leave/sickness types → backfill
  `users.roleIds` mirror.
- Idempotent by design: `$setOnInsert`/find-by-key semantics; existing data is
  never overwritten or deleted.
- This is the **only** seed system. No competing seed was created.

## Verification

Checks executed against the live cluster (read-only except the single
authorized password-hash rotation below):

1. `attendance_db` exists on cluster `hris-project`. ✅
2. Required collections exist (28 total, including `users`, `roles`,
   `permissions`, `role_permissions`, `user_roles`, `sessions`,
   `refresh_tokens`, `audit_events`). ✅
3. Required indexes exist: unique `users.username` / `users.email`,
   unique `roles.key`, unique `permissions.key`, unique
   `role_permissions {roleId, permissionKey}`, unique
   `user_roles {userId, roleId}`, TTL on `sessions.expiresAt` and
   `refresh_tokens.expiresAt`, text index on users. ✅
4. SuperAdmin user exists: `superadmin` (ACTIVE). ✅
5. SUPER_ADMIN role exists (level 100, ACTIVE). ✅
6. Required permissions exist: 71 permission docs. ✅
7. Role–permission relationships exist: 71 rows in `role_permissions`. ✅
8. SuperAdmin–user relationship exists: 1 row in `user_roles`. ✅
9. Login works: `POST /api/v1/auth/signin` with the configured superadmin
   credentials returned 200, issued an access token, roles `["SUPER_ADMIN"]`,
   71 permissions. ✅ (After a single authorized rotation of the stored
   `passwordHash` to match the current `SEED_SUPER_ADMIN_PASSWORD` — the seed
   never overwrites an existing user's password, so the hash was re-hashed
   with the application's own `BcryptPasswordHasher` and applied via the
   application's own `UserRepository.updatePassword`.)
10. JWT authentication works: protected endpoints with Bearer token returned
    200 (`/navigation`, `/users`, `/rbac/roles`, `/rbac/permissions`). ✅
11. RBAC authorization works: SUPER_ADMIN resolves all 71 permissions and the
    menu tree; `GET /rbac/permissions` (guarded `rbac:view_permissions`)
    succeeds. ✅
12. Protected endpoints reject unauthorized users: anonymous `GET /users` →
    401; wrong password → 401. ✅

No credentials are exposed in any output; `MONGO_URI` is never printed.

## Production Safety

**Safe (idempotent, no data loss):**
- `seedDatabase` on boot (only creates missing records).
- Running `node scripts/show-access-collections.js` (`npm run access:show`) —
  connects, runs the same idempotent seed, prints an access report; never
  drops or deletes anything.
- `scripts/migrate-approval.js` — additive approval backfill; skips documents
  that already have an `approval` structure.

**Destructive — never run without explicit authorization:**
- `scripts/reset-database.js` (`npm run db:reset`) — drops the **entire**
  database and re-provisions only the minimal SUPER_ADMIN setup.
- Any direct `dropDatabase()`, `drop()`, `deleteMany({})` against the cluster.

**Operational notes:**
- Changing `SEED_SUPER_ADMIN_PASSWORD` after initial creation does **not**
  change an existing user's password; rotate it via the app's
  change-password flow or with the application's own hasher/repository
  (performed once during provisioning).
- Keep `JWT_SECRET` stable; changing it invalidates all tokens.
- Keep `AUDIT_CHAIN_SALT` stable; changing it breaks hash-chain verification.
