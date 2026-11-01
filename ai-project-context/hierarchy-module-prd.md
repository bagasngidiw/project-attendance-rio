# Modul Hirarki Kontrak dan Penempatan — PRD / Technical Design

## 1. Status

- Status: Approved for implementation
- Scope: hierarchy-aware visibility and approval routing for the existing single HRIS application
- Date: 2026-10-25
- Related architecture: `ai-project-context/project-context.md`

## 2. Confirmed business decisions

1. One hierarchy chart belongs to one `ContractType + Placement` combination.
2. A contract may have multiple placements; a placement may be reused only when the active contract-placement relation permits it.
3. No new Division/Bidang master is required for this module. Existing user role/position data is displayed on a hierarchy card and is never reassigned by the chart editor.
4. An approval target is selected from all active eligible users above the requester in the same hierarchy path. The nearest eligible ancestor is the default; other eligible ancestors remain selectable.
5. A request with no eligible ancestor approver is rejected at submission with a business error until the hierarchy/configuration is corrected.
6. The existing `User.managerId` is legacy reporting-line data. It is not the source of truth for the new hierarchy. It must not be removed because existing APIs and historical data may still depend on it.
7. The hierarchy module is integrated into the existing Role & Permission catalog through `hierarchy:view` and `hierarchy:manage`. Creating a role does not bind the role to a particular chart.

## 3. Product goal

Administrators can create a visual reporting hierarchy for a contract and placement. The hierarchy becomes the authoritative relationship used to scope subordinate records and resolve approval candidates while preserving the current authentication, RBAC, request, audit, and notification architecture.

For example, if the active chart for a contract and placement is:

```text
Acep
├── Supervisor B
│   └── User A
└── User C
```

then Acep can see permitted records for B, A, and C according to the role data scope. User A can choose eligible users above A (Supervisor B and/or Acep) as approval targets. User C cannot be selected because C is a peer, not an ancestor.

## 4. Current-state findings

- `contract_types` and `placements` are flat master collections.
- `User` already stores `contractTypeId`, `placementId`, `departmentId`, `positionId`, `roleIds`, and legacy `managerId`.
- Existing `Role.dataScope` values exist but runtime scope resolution is currently permission-driven and direct-report-only.
- The current attendance overview can become company-wide through `view_all` permissions.
- The shared request surface primarily exposes requester-owned history; there is no reusable subordinate request list.
- Approval target resolution is currently configuration/contract based, not hierarchy-ancestor based.
- The unified approval list can expose too many requests to users with `view_all`, while unclaimed role targets are not consistently returned to eligible users.
- The frontend has no graph library or reusable user combobox. Existing Tailwind cards, modal, toast, spinner, React Query, and permission components should be reused.

## 5. Terminology and boundaries

### 5.1 RBAC role

An existing authorization role. It grants menu/action permissions and contains an explicit data scope. The hierarchy editor never assigns or changes a role.

### 5.2 Position / role display

The user card may display the existing position and active RBAC role names. Display metadata is read-only in the hierarchy editor.

### 5.3 Hierarchy chart

A configuration scoped to exactly one active contract and placement. It contains user nodes and parent-child relationships. It may have multiple roots to represent separate top-level branches.

### 5.4 Ancestor

Any parent, grandparent, or higher node reached by following `parentNodeId` from a requester. Only ancestors can be approval candidates.

### 5.5 Descendant

Any child or deeper node below a user. Descendant resolution is recursive and cycle-safe.

## 6. Functional requirements

### HIER-FR-001 — Contract and placement scope

- List only active contracts and active placements.
- Placement choices must be limited to valid active contract-placement combinations.
- Creating the same chart scope is idempotent: return the existing chart instead of creating duplicates.
- A chart must not contain an inactive user or a user whose current contract/placement does not match the chart scope.

### HIER-FR-002 — Visual chart editor

- The page contains a scope panel and a chart workspace.
- The scope panel has contract select, placement select, and `Buat Bagan Hirarki`.
- After creation, the selected scope is shown as persistent context chips in the workspace.
- The chart uses recursive cards and connector lines; no third-party graph dependency is required for MVP.
- A chart may have multiple roots.

### HIER-FR-003 — Node operations

- Add child below an anchor.
- Insert parent above an anchor, preserving the anchor's former parent.
- Add sibling before/after an anchor, represented visually by left/right controls.
- Delete a leaf node.
- Delete a non-leaf only after explicit confirmation that children will be promoted to the deleted node's parent; root children become roots.
- Prevent duplicate users in one chart, self-parenting, cycles, invalid anchors, and stale-version writes.

### HIER-FR-004 — User selector

- Each insertion uses a server-backed searchable user combobox.
- Only active users matching the selected contract and placement are returned.
- Users already present in the chart are excluded.
- Display name, username/NIP, position, and existing role names.
- Never expose the entire user collection and filter it only in React.

### HIER-FR-005 — Hierarchy permissions

Register and mirror:

```text
hierarchy:view
hierarchy:manage
```

- `hierarchy:view` shows the hierarchy menu and read-only charts.
- `hierarchy:manage` permits chart creation and node mutations.
- `hierarchy:manage` implies read access at the service boundary, but frontend route permissions should accept either key where appropriate.
- Permission names and role names must never be hardcoded in business logic.

### HIER-FR-006 — Hierarchy-aware data visibility

Create one reusable scope service. It resolves visible user IDs from the authenticated user, active roles, role data scope, and active hierarchy charts.

The effective behavior is:

- `SELF`: requester only.
- `DIRECT_SUBORDINATES`: requester plus direct children.
- `DIRECT_AND_INDIRECT_SUBORDINATES`: requester plus all recursive descendants.
- `DEPARTMENT`: preserve the existing department behavior until a future policy explicitly replaces it.
- `ALL_EMPLOYEES`: company-wide only when the role explicitly has this scope.

Module permissions remain required. A hierarchy relationship never grants attendance, request, report, or approval permission by itself.

Apply the resolved user-ID intersection server-side to attendance, request lists/details, reports, dashboards, and approval views. A user-provided `employeeId` or search must be intersected with the allowed set and must never replace it.

### HIER-FR-007 — Approval target resolution

- Extend the reusable approval target service rather than adding per-module implementations.
- Resolve the requester's active chart from their current contract and placement.
- Walk all ancestors and filter them by active status, actual RBAC membership, request-type approval permission, approval configuration, approval level, and self-approval policy.
- Return nearest eligible ancestor first, then higher eligible ancestors.
- The target selector shows only backend-provided eligible ancestor users. It does not show peers, descendants, or arbitrary users.
- If there is no eligible ancestor, request submission returns a business `400` and does not create a pending request.
- Existing role-target behavior remains available only where it does not violate the hierarchy policy; explicit hierarchy user targets are the primary UX.

### HIER-FR-008 — Approval inbox

- The canonical approval inbox must show only pending requests the current user can actually act on.
- A direct user-target request is visible to its assigned user.
- A role-target request is visible to eligible ancestor users until atomically claimed.
- Existing broad `view_all` permissions must not bypass assignment/ancestor eligibility for approval actions.
- The old and new decision paths must persist the same embedded approval fields. The canonical engine remains responsible for approve/reject.

### HIER-FR-009 — Snapshot and audit

At request submission, store hierarchy context in the approval configuration snapshot:

- hierarchy ID and version
- contract and placement IDs and display-name snapshots
- requester node ID
- ancestor chain with user, position, role, name, and distance snapshots
- eligible approver IDs used for role-target inbox visibility

Chart mutations record append-only history and audit events with actor snapshots. Existing request approval history is preserved.

### HIER-FR-010 — Legacy compatibility

- Do not delete `User.managerId` or `reporting_history`.
- Existing reporting-line endpoints remain available for legacy records.
- New hierarchy visibility and approval logic uses the hierarchy chart first.
- A migration/reconciliation script may use `managerId` to suggest or build an initial chart, but must not fabricate hierarchy links where data is ambiguous.
- User contract/placement changes that would leave a published node invalid must be rejected with a business error until the chart is corrected.

## 7. MongoDB design

### 7.1 `contract_placements`

```text
contractTypeId  ObjectId -> ContractType
placementId     ObjectId -> Placement
status          ACTIVE | INACTIVE
effectiveFrom   Date|null
effectiveTo     Date|null
createdBy       ObjectId|null
updatedBy       ObjectId|null
version         Number
timestamps      true
```

Unique index: `{ contractTypeId: 1, placementId: 1 }`.

### 7.2 `hierarchies`

```text
contractTypeId  ObjectId -> ContractType
placementId     ObjectId -> Placement
status          DRAFT | ACTIVE | ARCHIVED
nodes           embedded array
version         Number
createdBy       ObjectId|null
updatedBy       ObjectId|null
activatedAt     Date|null
activatedBy     ObjectId|null
timestamps      true
```

Each node:

```text
nodeId          ObjectId/string
userId          ObjectId -> User
parentNodeId    ObjectId/string|null
sortOrder       Number
```

Unique index: `{ contractTypeId: 1, placementId: 1 }`. One document per scope keeps each chart mutation atomic on the existing MongoDB deployment without requiring a new transaction dependency.

### 7.3 `hierarchy_history`

Append-only events:

```text
hierarchyId
event: CREATED | NODE_ADDED | NODE_REPARENTED | NODE_REMOVED | ACTIVATED | ARCHIVED
actorId
actorNameSnapshot
actorRoleNameSnapshots
before
after
recordedAt
version
```

## 8. API design

Use the existing `/api/v1` envelope and route-factory conventions.

```text
GET    /api/v1/hierarchies?contractTypeId=&placementId=&status=
POST   /api/v1/hierarchies
GET    /api/v1/hierarchies/:id
GET    /api/v1/hierarchies/:id/users?search=
POST   /api/v1/hierarchies/:id/nodes
DELETE /api/v1/hierarchies/:id/nodes/:nodeId
POST   /api/v1/hierarchies/:id/activate
POST   /api/v1/hierarchies/:id/archive
GET    /api/v1/hierarchies/:id/history
GET    /api/v1/contract-placements?contractTypeId=
```

Node insertion payload:

```json
{
  "userId": "...",
  "anchorNodeId": "...",
  "relation": "CHILD | PARENT | SIBLING_BEFORE | SIBLING_AFTER",
  "expectedVersion": 3
}
```

Delete payload:

```json
{
  "expectedVersion": 3,
  "promoteChildren": true
}
```

All writes require `hierarchy:manage`, validate active master references, and use a conditional version update.

## 9. Frontend design

Create a feature-based module:

```text
frontend/src/features/hierarchy/
  HierarchyPage.tsx
  HierarchyScopePanel.tsx
  HierarchyCanvas.tsx
  HierarchyNodeCard.tsx
  HierarchyNodeDialog.tsx
  UserCombobox.tsx
  hierarchy-tree.ts
```

Reuse `Modal`, `Button`, `Input`, `Spinner`, toast, React Query, `MasterSelects` conventions, permission guards, and brand CSS variables. Use initials rather than inventing an avatar storage system.

States required:

- no scope selected
- loading scope/chart/users
- empty chart
- chart loaded
- saving
- version conflict
- validation error
- inactive/missing master reference
- mobile horizontal-scroll fallback

## 10. Testing plan

Backend unit tests:

- chart node transformation and ordering
- parent/child/sibling insertion
- deletion and child promotion
- duplicate/cycle/self-parent prevention
- scope resolution for direct and recursive descendants
- contract and placement boundaries
- inactive users and stale versions
- ancestor resolution and nearest-first ordering
- no eligible approver rejection
- approval inbox visibility and target-role enforcement

Backend integration tests:

- hierarchy permissions and routes
- create/load/update/activate chart
- Acep sees A/B/C records but not unrelated users
- request list/detail hierarchy scope
- approval target returns all eligible ancestors
- request submission without approver returns `400`
- approval inbox excludes unrelated pending requests
- two concurrent node updates produce one successful version

Frontend tests/build:

- tree reducer operations
- node control callbacks
- combobox filtering/loading/empty/error behavior
- permission-gated page rendering
- TypeScript production build and ESLint

All automated database tests must use isolated test MongoDB configuration. Never load or mutate production `.env` values during verification.

## 11. Definition of done

- [ ] Chart creation is scoped to one contract and placement.
- [ ] Visual node editor supports parent, child, sibling, and delete.
- [ ] User autocomplete is backend-filtered and role display is read-only.
- [ ] `hierarchy:view` and `hierarchy:manage` are available in RBAC.
- [ ] Hierarchy scope is enforced server-side on all requested data modules.
- [ ] All ancestors can be approval candidates when eligible.
- [ ] Submission without an eligible ancestor is blocked.
- [ ] Approval inbox contains only actionable requests.
- [ ] Existing managerId/reporting data remains intact.
- [ ] Audit/history and optimistic locking are implemented.
- [ ] Automated tests, frontend build, lint, and regression suite pass.
