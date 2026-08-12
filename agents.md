# AGENTS.md — HRIS Approval Workflow Revamp

## 0. Mission

Revamp the approval workflow for:

1. Overtime (`Lembur`)
2. Business Trip (`Perjalanan Dinas / SPPD`)
3. Permission (`Perijinan`)
   - Leave / Cuti
   - Permission / Ijin

The system is an existing **single HRIS application** with role-based menus and permissions.

### Existing stack

- Frontend: React + Vite
- Backend: Node.js / Express
- Database: MongoDB + Mongoose
- Authentication: existing authentication implementation
- Authorization: existing RBAC implementation
- Application model: one application for employees/admins; access is controlled by roles and permissions

### Critical constraint

**Do not create separate Employee and Admin applications.**

Do not replace the existing RBAC system.

The approval system must integrate with the existing role/permission infrastructure.

---

# 1. Product Goal

Replace the current hardcoded approval behavior with a configurable, enterprise-style approval assignment system.

A requester must be able to submit a request and select:

- a specific eligible role as the approver target, OR
- a specific eligible user as the approver target.

The Superadmin controls:

- which roles are allowed to approve each request type,
- the approval level of each role,
- which request types each role may approve,
- whether users with a particular role can become selectable approvers.

The system must record the approval target and the actual person who performs the approval.

Every request must contain an auditable:

- `Approved By`
- approval target
- approval status
- approval timestamp
- rejection reason when rejected

---

# 2. Approval Philosophy

The system should follow this principle:

> RBAC determines who is authorized to approve.  
> The requester determines which eligible role/user should receive the request.  
> The server validates the entire decision.

Never trust the frontend to determine whether somebody is allowed to approve.

The frontend only displays valid choices.

The backend is always authoritative.

---

# 3. Approval Lifecycle

Use the following lifecycle:

```text
DRAFT
  |
  v
SUBMITTED
  |
  v
PENDING_APPROVAL
  |
  +--------------------+
  |                    |
  v                    v
APPROVED             REJECTED
                         |
                         v
                    TERMINAL STATE
```

For MVP, do NOT implement a rejected-request "resubmit" action.

If rejected:

```text
REJECTED
   |
   X
   |
   +--> Requester must create a new request
```

A rejected request must never silently return to `PENDING_APPROVAL`.

---

# 4. Approval Rules

## 4.1 Eligible approvers

An approver is eligible only when all required conditions are satisfied:

1. User is active.
2. User belongs to a role that is configured for approval.
3. The role is allowed to approve the specific request type.
4. The role has sufficient approval level according to the configured policy.
5. If the requester selected a specific user, that user is currently eligible.
6. The approver is not the requester unless the business policy explicitly allows self-approval.
7. The request is still in `PENDING_APPROVAL`.
8. The approval assignment has not already been completed.

Do not rely on menu visibility as approval authorization.

---

# 5. Role Approval Configuration

Superadmin must have a dedicated configuration area.

Recommended concept:

```text
Approval Configuration
├── Overtime
├── Business Trip
├── Leave
└── Permission
```

For each request type, Superadmin can configure eligible roles.

Example:

```text
Overtime
--------------------------------
Role                 Level    Can Approve
HR Manager            3          Yes
Supervisor            2          Yes
Employee              0          No
Finance               1          No
```

The exact roles must come from the existing RBAC database.

**Do not hardcode role names such as `Admin`, `HR`, `Manager`, etc.**

---

# 6. Approval Level

Use a numeric approval level.

Example:

```text
0 = cannot approve
1 = basic approval
2 = intermediate approval
3 = senior approval
4 = highest operational approval
```

The actual meaning of each level should remain configurable.

The system must not assume that a role named `Admin` automatically has a higher level.

Example:

```text
Role: Supervisor
Approval Level: 2

Role: HR Manager
Approval Level: 3

Role: Superadmin
Approval Level: 999
```

The numeric values are examples only.

The Superadmin controls the configuration.

---

# 7. Important Distinction: Role Target vs User Target

When a requester creates a request, they can select either:

### Option A — Target Role

Example:

```text
Approval Target Type:
[ Role ]

Role:
[ HR Manager ]
```

The system finds users who currently belong to that role and are eligible to approve.

### Option B — Target User

Example:

```text
Approval Target Type:
[ Specific User ]

User:
[ Budi - HR Manager ]
```

The backend verifies that Budi is currently eligible to approve the request type.

---

# 8. Recommended Assignment Behavior

Do not leave a request in an ambiguous state such as:

```text
Approved By: HR Manager
```

That is not enough.

Store both:

```text
Approval Target
    type: ROLE
    roleId: ...

Approval Assignment
    assignedUserId: ...
```

or:

```text
Approval Target
    type: USER
    userId: ...

Approval Assignment
    assignedUserId: ...
```

### Why?

A role can contain multiple users.

If the requester selects:

```text
HR Manager
```

the system needs a deterministic mechanism for deciding who can act.

Recommended behavior:

1. Requester selects a role.
2. Backend resolves eligible active users for that role.
3. Request becomes visible to those eligible users.
4. The first authorized eligible approver who takes ownership claims the request.
5. After claiming, the request is assigned to that user.
6. Only the assigned user can approve/reject it.

This prevents two HR Managers from approving the same request simultaneously.

If the existing business rules require all members of a role to see the request, they may see it, but only one user can successfully claim it.

---

# 9. Approval Assignment State

Recommended fields:

```text
approval.targetType
approval.targetRoleId
approval.targetUserId

approval.assignedUserId
approval.assignedAt

approval.status
approval.approvedBy
approval.approvedAt

approval.rejectionReason
approval.rejectedBy
approval.rejectedAt
```

Do not duplicate contradictory sources of truth.

Recommended meaning:

- `targetRoleId`: what role the requester selected
- `targetUserId`: what specific user the requester selected
- `assignedUserId`: the actual approver currently responsible
- `approvedBy`: the actual user who approved
- `rejectedBy`: the actual user who rejected

---

# 10. Approval Status

Use explicit statuses.

Recommended enum:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
CANCELLED
```

Only add additional states if the existing product genuinely requires them.

Do not use vague strings such as:

```text
waiting
done
finished
approved_by_admin
```

Use one consistent status model across:

- Overtime
- Business Trip
- Leave
- Permission

---

# 11. Request Creation Flow

## Step 1 — Requester opens create form

Example:

```text
Create Overtime Request

Date
Start Time
End Time
Reason

Approval Target
( ) Role
( ) Specific User

If Role:
    [ Select eligible role ]

If User:
    [ Select eligible user ]

[ Submit Request ]
```

Use the same concept for:

- Business Trip
- Leave
- Permission

---

# 12. Approval Target API Data

Create a reusable backend endpoint/service for retrieving eligible approval targets.

Conceptually:

```text
GET /api/v1/approval-targets?type=overtime
```

Possible response:

```json
{
  "roles": [],
  "users": []
}
```

The exact endpoint naming should follow the existing project's API conventions.

Do not create four completely different implementations.

Create one reusable approval-target service.

---

# 13. Backend Validation

When submitting a request, the backend must validate:

### Role target

```text
1. Role exists
2. Role is active
3. Role is configured for this request type
4. Role has sufficient approval level
5. At least one eligible active user exists
```

### User target

```text
1. User exists
2. User is active
3. User has an eligible role
4. The role is configured for this request type
5. User has sufficient approval level
```

If any validation fails:

```text
400 Bad Request
```

with a clear business error.

Do not accept arbitrary role IDs or user IDs from the client.

---

# 14. Snapshot Important Approval Configuration

This is extremely important.

Do not rely only on the current role configuration forever.

At submission time, store the relevant approval configuration snapshot.

For example:

```text
approval.configurationSnapshot
    targetType
    targetRoleId
    targetRoleName
    targetRoleLevel
    targetUserId
    targetUserName
    requestType
```

Why?

Suppose:

```text
Monday:
Requester submits request to HR Manager.

Tuesday:
Superadmin changes HR Manager's approval level.

Wednesday:
HR Manager approves Monday's request.
```

The historical request should remain auditable according to the rules under which it was created.

Do not rewrite historical approval decisions because current RBAC configuration changed.

---

# 15. Approval Claiming

If the requester selected a ROLE instead of a specific user:

```text
PENDING_APPROVAL
      |
      v
Eligible users see request
      |
      v
User clicks "Take Approval"
      |
      v
Backend performs atomic assignment
      |
      v
assignedUserId = currentUser
      |
      v
Assigned user can Approve / Reject
```

The assignment must be atomic.

Do not implement:

```text
GET request
check assignedUserId
UPDATE request
```

as separate unsafe operations.

Use a MongoDB atomic update / conditional update so two approvers cannot successfully claim the same request.

---

# 16. Approval Actions

An eligible assigned approver gets:

```text
[ Approve ]
[ Reject ]
```

## Approve

On approval:

```text
status = APPROVED
approvedBy = currentUser
approvedAt = now
```

The request becomes terminal.

No further approval action is allowed.

## Reject

Reject must require a reason.

Example modal:

```text
Reject Request

Reason *
[................................]

[Cancel] [Reject Request]
```

Backend validation:

```text
rejectionReason must exist
rejectionReason must not be blank
```

On rejection:

```text
status = REJECTED
rejectedBy = currentUser
rejectedAt = now
rejectionReason = provided reason
```

The request becomes terminal.

---

# 17. "Approved By" Display

Every request detail page must clearly display:

```text
Approval Status: Approved
Approved By: Budi Santoso
Approved At: 09 Aug 2026 14:30
```

For pending:

```text
Approval Status: Pending Approval
Approval Target: HR Manager
Assigned Approver: Budi Santoso
```

For rejected:

```text
Approval Status: Rejected
Rejected By: Budi Santoso
Rejected At: 09 Aug 2026 14:30
Reason:
Overtime was submitted outside the approved schedule.
```

The requester must be able to see the rejection reason.

---

# 18. Audit Trail

Approval actions are business-critical.

Create an approval history/audit trail.

Recommended events:

```text
SUBMITTED
ASSIGNED
CLAIMED
APPROVED
REJECTED
CANCELLED
```

Each event should record:

```text
action
actorId
actorNameSnapshot
actorRoleId
actorRoleNameSnapshot
timestamp
reason
metadata
```

Use snapshots where appropriate so historical records remain readable even after users/roles change.

---

# 19. Recommended MongoDB Structure

Do not create a completely separate approval database for every module.

Use a reusable approval structure embedded in each request document or a reusable approval collection if that better matches the existing architecture.

Recommended conceptual structure:

```text
Overtime
BusinessTrip
Leave
Permission
    |
    +-- approval
          |
          +-- targetType
          +-- targetRoleId
          +-- targetUserId
          +-- assignedUserId
          +-- status
          +-- approvedBy
          +-- approvedAt
          +-- rejectedBy
          +-- rejectedAt
          +-- rejectionReason
          +-- configurationSnapshot
```

And:

```text
approvalHistory[]
```

Do not introduce a separate approval microservice.

This is an internal HRIS application and should remain maintainable.

---

# 20. Reusable Backend Architecture

Do not implement approval logic separately four times.

Create a reusable domain/service layer.

Conceptual architecture:

```text
controllers/
    overtimeController
    businessTripController
    leaveController
    permissionController

services/
    approvalService
    approvalTargetService
    approvalAuthorizationService

models/
    Overtime
    BusinessTrip
    Leave
    Permission
    Role
    User
```

The exact directory names must follow the existing project architecture.

The important requirement is separation of responsibilities.

---

# 21. Approval Service Responsibilities

Create a reusable approval service responsible for:

```text
getEligibleRoles()
getEligibleUsers()
validateTarget()
createApprovalAssignment()
claimApproval()
approve()
reject()
getApprovalHistory()
```

Do not put all approval logic directly inside React components or Express controllers.

Controllers should orchestrate.

Services should contain business rules.

Models should contain persistence/schema concerns.

---

# 22. Authorization Rules

There are two different concepts:

### Application permission

Example:

```text
OVERTIME_VIEW
OVERTIME_CREATE
OVERTIME_APPROVE
```

### Approval eligibility

Example:

```text
Role:
HR Manager

Approval configuration:
OVERTIME -> Level 3
```

A user should only be allowed to approve when both layers permit it.

Conceptually:

```text
Authenticated
    AND
Has required application permission
    AND
Role is configured as eligible approver
    AND
Approval level is sufficient
    AND
Is assigned/authorized for this request
```

Do not assume that:

```text
can view overtime
```

means:

```text
can approve overtime
```

---

# 23. Superadmin Configuration

Add a configuration UI for Superadmin.

Example:

```text
Settings
└── Approval Workflow

    Overtime
      ├── Eligible Roles
      └── Approval Level

    Business Trip
      ├── Eligible Roles
      └── Approval Level

    Leave
      ├── Eligible Roles
      └── Approval Level

    Permission
      ├── Eligible Roles
      └── Approval Level
```

Superadmin can:

- enable/disable approval capability for a role
- configure approval level
- remove a role from approval eligibility
- inspect which users are eligible
- understand the impact of configuration changes

Never hardcode these settings in React.

---

# 24. Frontend React/Vite Architecture

Create reusable components.

Conceptually:

```text
components/
    approval/
        ApprovalTargetSelector
        ApprovalStatusBadge
        ApprovalSummary
        ApprovalHistory
        ApprovalActionPanel
        RejectRequestDialog
```

Use these components across:

```text
Lembur
Perjalanan Dinas
Perijinan
```

Do not build four visually and logically different approval systems.

---

# 25. Requester UX

On every create form, show:

```text
Approval Request
```

Then:

```text
Who should approve this request?

( ) Select Role
( ) Select User
```

When Role is selected:

```text
Eligible Roles
----------------
HR Manager
Supervisor
Operations Manager
```

When User is selected:

```text
Eligible Users
----------------
Budi Santoso — HR Manager
Andi Wijaya — Supervisor
```

Only display backend-provided eligible targets.

Never expose every user in the database and filter only in React.

---

# 26. Approver UX

Create an approval inbox.

Conceptually:

```text
Approval Inbox

Pending
-----------------------------------------
Overtime       Bagas      09 Aug  10:00
Leave          Andi       09 Aug  09:30
Business Trip  Sinta      08 Aug  15:20
```

Filters:

```text
Request Type
Status
Date
Requester
```

For role-targeted requests, users should only see requests they are actually eligible to act upon.

---

# 27. Approval Detail Page

The approval detail should show:

```text
Request Information
-------------------
Requester
Request Type
Request Date
Description
Supporting Documents

Approval Information
-------------------
Status
Target Role / Target User
Assigned Approver
Approval Level

Approval History
----------------
Submitted
Assigned
Approved / Rejected

Actions
----------------
Approve
Reject
```

Do not hide approval information inside unrelated tabs.

---

# 28. API Design

Follow the existing API conventions.

Recommended conceptual operations:

```text
GET    /approval-targets
POST   /.../requests
GET    /.../requests
GET    /.../requests/:id
POST   /.../requests/:id/claim
POST   /.../requests/:id/approve
POST   /.../requests/:id/reject
GET    /.../requests/:id/approval-history
```

For Superadmin:

```text
GET    /approval-configurations
PUT    /approval-configurations/:requestType
```

Do not blindly copy these paths if the existing API has established conventions.

Preserve consistency with the existing backend.

---

# 29. Security Requirements

The backend must protect against:

### Unauthorized approval

A normal user cannot call:

```text
POST /approve
```

and approve a request they are not eligible for.

### User ID spoofing

Never trust:

```json
{
  "approvedBy": "some-user-id"
}
```

The server must determine the approver from the authenticated session/token.

### Role spoofing

Never trust:

```json
{
  "roleId": "admin"
}
```

from the client for authorization.

Resolve the user's actual roles from the database/authentication context.

### Double approval

A request already marked:

```text
APPROVED
```

cannot be approved again.

### Approve after rejection

A request marked:

```text
REJECTED
```

cannot be approved.

### Reject without reason

Reject requests without a meaningful reason must be rejected by backend validation.

### Self approval

Prevent requester = approver unless Superadmin explicitly enables a policy allowing it.

Default:

```text
selfApproval = false
```

---

# 30. Concurrency

MongoDB operations must be designed for concurrent approvers.

Example scenario:

```text
HR Manager A opens request
HR Manager B opens request

A clicks Approve
B clicks Approve
```

The database must guarantee only one successful transition.

Use conditional/atomic updates based on the current status and assignment.

Never rely on:

```text
frontend button disabled
```

for concurrency protection.

---

# 31. Status Transition Rules

Implement an explicit transition policy.

Allowed:

```text
DRAFT -> PENDING_APPROVAL

PENDING_APPROVAL -> APPROVED
PENDING_APPROVAL -> REJECTED
PENDING_APPROVAL -> CANCELLED
```

Not allowed:

```text
APPROVED -> PENDING_APPROVAL
APPROVED -> REJECTED
REJECTED -> APPROVED
REJECTED -> PENDING_APPROVAL
CANCELLED -> APPROVED
```

The backend must enforce these transitions.

---

# 32. Existing Data Migration

Before changing schemas:

1. Inspect current MongoDB documents.
2. Identify current approval fields.
3. Identify current statuses.
4. Identify existing approval relationships.
5. Create a migration strategy.
6. Do not destroy historical approval information.

If old documents do not have the new approval structure:

```text
approval.status = legacy-derived status
```

only when the historical meaning is unambiguous.

Do not fabricate historical approvers.

If an old record has no known approver:

```text
approvedBy = null
```

is preferable to inventing data.

---

# 33. Backward Compatibility

Do not break unrelated HRIS modules.

Before modifying approval logic, identify:

```text
Attendance
Users
Roles
Permissions
Reports
Authentication
Dashboard
```

and determine whether they depend on the existing request schemas/statuses.

Approval refactoring must not silently break:

- reports
- dashboard counts
- employee history
- admin summaries
- notification logic
- existing APIs

---

# 34. Reports

Existing reports must continue working.

Approval-related reports should be able to answer:

```text
Who submitted?
What was requested?
Who was targeted?
Who actually approved?
What role did the approver have?
When was it approved?
Was it rejected?
Who rejected it?
Why?
```

Do not store only the current role name.

Historical role/name snapshots are recommended for auditability.

---

# 35. Notification Readiness

Do not make notifications the first implementation priority.

However, design the approval model so notifications can later be added.

Future events:

```text
REQUEST_SUBMITTED
REQUEST_ASSIGNED
REQUEST_CLAIMED
REQUEST_APPROVED
REQUEST_REJECTED
```

Possible future channels:

```text
In-app notification
Email
WhatsApp
Push notification
```

Do not tightly couple approval business logic to a notification provider.

---

# 36. Implementation Order

The developer must implement in this order.

## Phase 1 — Inspect existing system

Before changing code:

- inspect User model
- inspect Role model
- inspect permission model
- inspect authentication middleware
- inspect current approval logic
- inspect Overtime schema
- inspect Business Trip schema
- inspect Leave schema
- inspect Permission schema
- inspect existing API conventions
- inspect React routing
- inspect current request forms
- inspect current admin approval pages

Do not start coding before understanding the existing architecture.

---

## Phase 2 — Define approval domain

Create the reusable approval domain model.

Define:

```text
ApprovalStatus
ApprovalTargetType
ApprovalEventType
Approval configuration
Approval snapshot
```

Keep these concepts consistent across all four modules.

---

## Phase 3 — Backend approval engine

Implement:

1. target resolution
2. eligibility validation
3. approval assignment
4. claiming
5. approve
6. reject
7. approval history
8. status transitions
9. authorization checks
10. concurrency protection

---

## Phase 4 — Superadmin configuration

Implement configurable role approval rules.

Superadmin should be able to configure:

```text
Request Type
Role
Approval Level
Enabled/Disabled
```

Do not hardcode roles.

---

## Phase 5 — Requester UI

Update:

- Overtime creation
- Business Trip creation
- Leave creation
- Permission creation

Add reusable:

```text
ApprovalTargetSelector
```

---

## Phase 6 — Approver UI

Create/revise:

```text
Approval Inbox
Approval Detail
Approve Action
Reject Action
Rejection Reason Dialog
Approval History
```

---

## Phase 7 — Migration

Migrate existing data carefully.

Do not destroy historical records.

---

## Phase 8 — Reports and summaries

Update:

- overtime summary
- business trip summary
- permission summary
- attendance/report dependencies

Ensure approval information remains available.

---

# 37. Testing Requirements

The developer must create tests for at least these scenarios.

### Requester

- requester can submit overtime
- requester can submit business trip
- requester can submit leave
- requester can submit permission
- requester can select eligible role
- requester can select eligible user
- requester cannot select unauthorized role
- requester cannot select unauthorized user

### Approver

- eligible approver can see request
- eligible approver can claim role-targeted request
- assigned approver can approve
- assigned approver can reject
- rejection requires reason
- unauthorized user cannot approve
- unauthorized user cannot reject

### State

- approved request cannot be approved twice
- approved request cannot be rejected
- rejected request cannot be approved
- rejected request cannot be resubmitted
- cancelled request cannot be approved

### Security

- forged `approvedBy` is ignored/rejected
- forged role ID is ignored/rejected
- inactive user cannot approve
- user without approval permission cannot approve
- self-approval is prevented by default

### Concurrency

- two users cannot claim the same request
- two users cannot approve the same request
- simultaneous approval/rejection results in exactly one valid terminal transition

---

# 38. UX Requirements

The UI should feel like a professional commercial HRIS product.

Avoid:

- browser alerts for important approval actions
- ambiguous status labels
- hardcoded role names
- giant forms without sections
- unexplained approval errors
- allowing invalid selections and discovering errors only after submit

Use:

- clear status badges
- confirmation dialogs
- rejection reason dialog
- loading states
- empty states
- error states
- success feedback
- disabled states during mutation
- readable approval history
- responsive layouts

---

# 39. Error Handling

Use business-oriented error messages.

Bad:

```text
MongoServerError
CastError
Forbidden
```

Good:

```text
You are not authorized to approve this request.
```

```text
The selected approver is no longer eligible.
Please select another approver.
```

```text
This request has already been approved.
```

```text
A rejection reason is required.
```

Do not expose internal stack traces to users.

---

# 40. Developer Rules

### Rule 1

Do not rewrite the entire application.

Modify the existing architecture incrementally.

### Rule 2

Do not create a second RBAC system.

Use the existing RBAC implementation.

### Rule 3

Do not hardcode role names.

### Rule 4

Do not trust frontend authorization.

### Rule 5

Do not duplicate approval logic across four modules.

### Rule 6

Do not introduce unnecessary microservices.

### Rule 7

Do not remove historical approval data.

### Rule 8

Do not implement rejected-request editing/reapproval in this phase.

### Rule 9

Do not allow approval status changes directly from generic CRUD endpoints.

Approval actions must go through dedicated business operations.

### Rule 10

Do not consider the feature complete until backend authorization, frontend UX, migration, concurrency, and tests are handled.

---

# 41. Definition of Done

The revamp is complete only when:

- [ ] Overtime uses the new approval engine
- [ ] Business Trip uses the new approval engine
- [ ] Leave uses the new approval engine
- [ ] Permission uses the new approval engine
- [ ] Requester can select role approver
- [ ] Requester can select specific user approver
- [ ] Superadmin controls eligible approval roles
- [ ] Superadmin controls approval levels
- [ ] Backend validates approval eligibility
- [ ] Approval target is persisted
- [ ] Actual approver is persisted
- [ ] `Approved By` is visible
- [ ] Rejection reason is mandatory
- [ ] `Rejected By` is visible
- [ ] Approval history exists
- [ ] Status transitions are enforced server-side
- [ ] Double approval is impossible
- [ ] Unauthorized approval is impossible
- [ ] Self approval is prevented by default
- [ ] Role-targeted requests can be safely claimed
- [ ] Concurrency is handled atomically
- [ ] Existing RBAC remains intact
- [ ] Existing menus remain role-based
- [ ] Existing reports continue working
- [ ] Existing historical data is preserved
- [ ] Automated tests cover critical approval paths
- [ ] Frontend has loading/error/empty/success states
- [ ] No approval logic is hardcoded in React
- [ ] No role names are hardcoded into business logic

---

# 42. Final Architectural Principle

The final architecture should conceptually look like:

```text
                    ┌─────────────────────┐
                    │     Superadmin      │
                    │ Approval Config     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Approval Policy     │
                    │ Role + Level + Type │
                    └──────────┬──────────┘
                               │
                               ▼
Requester ──submit──> Request + Approval Target
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Approval Engine     │
                    │ Validate + Assign   │
                    └──────────┬──────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
             Role Target                User Target
                  │                         │
                  ▼                         ▼
          Eligible Users              Specific User
                  │                         │
                  └────────────┬────────────┘
                               ▼
                         Approval Inbox
                               │
                         Claim / Assigned
                               │
                    ┌──────────┴──────────┐
                    │                     │
                 APPROVE               REJECT
                    │                     │
                    ▼                     ▼
               Approved              Rejected
                                      + Reason
                    │                     │
                    └──────────┬──────────┘
                               ▼
                         Audit History
```

The most important design decision is:

> **The requester chooses the approval target, but the requester never chooses who is authorized to approve.**

Authorization always comes from the Superadmin-managed approval configuration and the existing RBAC system.

The developer must first inspect the existing codebase and then implement this architecture using the project's current conventions rather than blindly creating a parallel architecture.
