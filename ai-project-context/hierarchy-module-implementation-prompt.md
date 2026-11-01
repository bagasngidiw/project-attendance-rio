# Implementation Prompt — Hierarchy Module

You are implementing the approved hierarchy module for the existing Internal HRIS SaaS application at `C:\Attendance System`.

## Mandatory context

Before changing application code, read:

1. `ai-project-context/project-context.md`
2. `ai-project-context/TODO.md`
3. `ai-project-context/hierarchy-module-prd.md`
4. `AGENTS.md`

Inspect actual source code before following any suggested path. The existing code is the source of truth.

## Confirmed business decisions

- One chart per active `ContractType + Placement` combination.
- No Division/Bidang master is required.
- Role is never assigned from the hierarchy chart; existing RBAC role membership remains authoritative.
- Approval candidates are all active eligible ancestors above the requester, nearest first.
- If no eligible ancestor exists, reject submission with a clear `400` business error.
- `User.managerId` is legacy compatibility data and is not the source of truth for the new chart.
- Add `hierarchy:view` and `hierarchy:manage` to the existing RBAC permission registry, frontend mirror, navigation catalog, seed/checklist, and role wizard metadata.

## Non-negotiable constraints

- Do not create separate employee/admin applications.
- Do not create a second RBAC system.
- Do not hardcode role names such as Manager, Supervisor, HR, or Admin.
- Do not trust frontend-selected user IDs for authorization.
- Do not expose arbitrary users in autocomplete and filter them only in React.
- Do not remove `managerId`, `reporting_history`, approval history, or historical request fields.
- Do not access or mutate production `.env`, production MongoDB, or live deployment data.
- Do not add a graph dependency unless the existing implementation proves the CSS tree insufficient.
- Do not refactor unrelated modules.

## Implementation order

### Phase 1 — Document and domain foundation

1. Add the PRD and this prompt to `ai-project-context`.
2. Add pure hierarchy enums, validation, and tree transformation functions.
3. Add Mongoose models for `contract_placements`, `hierarchies`, and `hierarchy_history`.
4. Add repositories and in-memory fakes.
5. Add unit tests for every tree operation and invariant.

### Phase 2 — Backend hierarchy APIs

1. Add `HierarchyService` for scope creation, chart reads, user eligibility, node operations, activation, archive, and history.
2. Use conditional version updates for every write.
3. Add DTOs, controllers, route factory, and server composition-root wiring.
4. Protect reads/writes with existing `authenticate` and `authorize` middleware.
5. Return `{ data }` and existing business error envelopes.

### Phase 3 — RBAC integration

1. Register `hierarchy:view` and `hierarchy:manage` in `backend/src/domain/permissions.js`.
2. Mirror them in `contracts/permissions.ts`.
3. Add them to checklist group generation and seed permission data.
4. Add the hierarchy menu to the server navigation catalog and frontend static fallback.
5. Ensure Role Wizard displays the new permission group without binding a role to a specific chart.

### Phase 4 — Frontend hierarchy editor

1. Add typed hierarchy contracts.
2. Add Axios methods.
3. Add the protected route, sidebar item, breadcrumb, and page.
4. Build the two-pane scope/chart UX using existing UI primitives.
5. Implement recursive CSS tree cards and four insertion controls.
6. Implement the server-backed `UserCombobox` with debounce, keyboard accessibility, loading, empty, and error states.
7. Show existing user role/position data read-only.
8. Add mutation loading, success, conflict, and error feedback.

### Phase 5 — Hierarchy-aware visibility

1. Add a reusable backend hierarchy scope resolver.
2. Make explicit role data scope authoritative while preserving existing permission checks.
3. Resolve direct and recursive descendants from published/active charts.
4. Apply allowed user IDs at repository/service boundaries for attendance, requests, reports, dashboard summaries, and details.
5. Intersect user-provided employee filters with allowed IDs to prevent filter bypass.
6. Keep requester-owned history working unchanged.

### Phase 6 — Approval integration

1. Extend `ApprovalTargetService` to resolve ancestors in the requester chart.
2. Require current active status, actual RBAC membership, configured request-type approval role, approval permission, level, and self-approval policy.
3. Store hierarchy ID/version, requester node, ancestor snapshots, and eligible approver IDs in the approval configuration snapshot.
4. Make the selector show ancestor users only and select the nearest eligible user by default.
5. Reject request creation when no eligible ancestor exists.
6. Update unified inbox and drill-down authorization so only actionable requests are returned.
7. Canonicalize legacy decision paths so embedded approval fields and history remain consistent.
8. Preserve atomic claim and terminal-state version guards.

### Phase 7 — Compatibility and migration

1. Preserve legacy `managerId` and reporting APIs.
2. Add a safe migration/reconciliation script only if actual existing data requires it.
3. Do not fabricate hierarchy links or historical approvers.
4. Block user contract/placement changes that would invalidate active chart membership, with a business error explaining the required chart operation.

### Phase 8 — Verification

Run only against local/test configuration:

```text
backend: npm run test:unit
backend: npm run test:integration
frontend: npm run build
frontend: npm run lint
```

Use `MONGO_URI_TEST` or the repository's isolated test database conventions. Never run `db:reset` against production. Review `git diff`, `git diff --check`, and `git status` before completion.

## Required acceptance scenarios

- An administrator can create a chart for an active contract and placement.
- The same scope cannot create a duplicate chart.
- Users can be inserted above, below, and beside existing nodes.
- A duplicate user or cycle is rejected.
- Acep can see permitted records belonging to all descendants in his chart.
- An unrelated user cannot see those records.
- User A sees every eligible ancestor above A as an approval target.
- User A cannot submit when the chart has no eligible ancestor approver.
- Acep's approval inbox excludes requests outside his hierarchy.
- An unauthorized user cannot read or mutate charts.
- Two stale chart writes cannot both succeed.
- Existing self-service request history, legacy manager data, authentication, and RBAC remain functional.

## Completion report

After implementation:

1. Mark only verified requirements `[x]` in `ai-project-context/TODO.md`.
2. Add an Implementation Summary listing changed files, database changes, API changes, remaining work, and verification results.
3. If any requirement is blocked, leave it unchecked and document the exact blocker.
