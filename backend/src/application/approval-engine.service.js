/**
 * ApprovalEngineService (FR-002) — the reusable approval engine shared by
 * Overtime, Business Trip, Leave and Permission.
 *
 * Responsibilities (agents.md §21):
 *   - validateTarget            : full backend target validation (FR-001/FR-003)
 *   - buildAssignment           : resolve assignment + configuration snapshot
 *   - createApprovalAssignment  : persist the assignment at submission
 *   - claimApproval             : atomic claim for role-targeted requests
 *   - approve / reject          : terminal decisions (rejection reason mandatory)
 *   - getApprovalHistory        : append-only timeline
 *
 * Authorization is layered (agents.md §22): authenticated → permission →
 * configured eligible role → sufficient level → assigned for this request.
 */

const {
  APPROVAL_TARGET_TYPES,
  APPROVAL_STATUS,
  assertTargetShape,
  canClaim,
  assertRejectionReason,
  assertNoSelfApprovalUnlessAllowed,
} = require("../domain/approval");
const { REQUEST_STATUS } = require("../domain/request");
const { hasPermission } = require("../domain/permissions");
const { canOverrideApprovals } = require("../domain/approval-access");
const {
  NotFoundError,
  ValidationError,
  PermissionDeniedError,
  ConflictError,
} = require("../domain/errors");

class ApprovalEngineService {
  /**
   * @param {object} deps
   * @param {import('./approval-configuration.service').ApprovalConfigurationService} deps.approvalConfigurationService
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/request-event.repository').RequestEventRepository} deps.requestEventRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   */
  constructor({
    approvalConfigurationService,
    requestService,
    requestRepository,
    requestEventRepository,
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
    eventBus,
    hierarchyService = null,
  }) {
    this.approvalConfigurationService = approvalConfigurationService;
    this.requestService = requestService;
    this.requestRepository = requestRepository;
    this.requestEventRepository = requestEventRepository;
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.auditService = auditService;
    this.eventBus = eventBus;
    this.hierarchyService = hierarchyService;
  }

  /* -------------------------------------------------------------------------
   * Target validation & assignment (FR-003/FR-002)
   * ---------------------------------------------------------------------- */

  /**
   * Validates a requester-supplied target against the live configuration
   * (agents.md §13). Returns the normalized target.
   *
   * FR-004 (contract scoping): when `requesterId` is provided, eligibility is
   * checked against the requester's contract (same contract OR contract-less
   * approvers) so a requester can never target an approver from another
   * contract. The rule is enforced server-side only.
   *
   * @param {string} requestType
   * @param {{ targetType?: string, targetRoleId?: string|null, targetUserId?: string|null }} target
   * @param {{ requesterId?: string|null }} [opts]
   */
  async validateTarget(requestType, target = {}, { requesterId = null } = {}) {
    assertTargetShape(target);
    const contractTypeId = await this.resolveRequesterContract(requesterId);
    const hierarchy = this.hierarchyService && requesterId
      ? await this.hierarchyService.getAncestorUsers(requesterId)
      : null;
    const ancestorIds = new Set((hierarchy?.ancestors ?? []).map((user) => String(user.userId)));

    if (hierarchy?.requesterScoped && !hierarchy.chart) {
      throw new ValidationError(
        "Requester belum memiliki bagan hirarki aktif. Perbaiki bagan hirarki terlebih dahulu.",
        { field: "approvalTarget" }
      );
    }

    if (target.targetType === APPROVAL_TARGET_TYPES.ROLE) {
      const role = await this.roleRepository.assertExists(target.targetRoleId);
      if (role.status !== "ACTIVE") {
        throw new ValidationError("The selected approval role is not active.", {
          field: "approvalTarget.targetRoleId",
        });
      }
      const eligibleRoles = await this.approvalConfigurationService.getEligibleRoles(requestType);
      const match = eligibleRoles.find((r) => String(r.roleId) === String(target.targetRoleId));
      if (!match) {
        throw new ValidationError(
          "The selected role is not an eligible approver for this request type.",
          { field: "approvalTarget.targetRoleId" }
        );
      }
      // A role target must resolve to at least one eligible ACTIVE user.
      const users = await this.approvalConfigurationService.getEligibleUsers(
        requestType,
        target.targetRoleId,
        { contractTypeId }
      );
      const hierarchyUsers = hierarchy?.chart
        ? users.filter((user) => ancestorIds.has(String(user.userId)))
        : users;
      if (hierarchy?.chart && hierarchyUsers.length === 0) {
        throw new ValidationError(
          "Tidak ada approver yang eligible pada hirarki requester. Perbaiki bagan hirarki terlebih dahulu.",
          { field: "approvalTarget.targetRoleId" }
        );
      }
      if (!hierarchy?.chart && users.length === 0) {
        throw new ValidationError(
          "The selected role has no eligible approvers available.",
          { field: "approvalTarget.targetRoleId" }
        );
      }
      return {
        targetType: APPROVAL_TARGET_TYPES.ROLE,
        targetRoleId: String(target.targetRoleId),
        targetUserId: null,
        targetRoleName: match.roleName,
        targetRoleLevel: match.approvalLevel,
        targetUserName: null,
      };
    }

    // USER target
    const user = await this.userRepository.findById(target.targetUserId);
    if (!user || user.status !== "ACTIVE") {
      throw new ValidationError("The selected approver is not active or does not exist.", {
        field: "approvalTarget.targetUserId",
      });
    }
    const eligibleUsers = await this.approvalConfigurationService.getEligibleUsers(
      requestType,
      null,
      { contractTypeId }
    );
    const match = eligibleUsers.find((u) => String(u.userId) === String(target.targetUserId));
    if (!match) {
      throw new ValidationError(
        "The selected user is not an eligible approver for this request type.",
        { field: "approvalTarget.targetUserId" }
      );
    }
    if (hierarchy?.chart && !ancestorIds.has(String(target.targetUserId))) {
      throw new ValidationError(
        "Approver harus merupakan user yang berada di atas requester pada bagan hirarki.",
        { field: "approvalTarget.targetUserId" }
      );
    }
    return {
      targetType: APPROVAL_TARGET_TYPES.USER,
      targetRoleId: null,
      targetUserId: String(target.targetUserId),
      targetRoleName: match.roleName,
      targetRoleLevel: match.approvalLevel,
      targetUserName: match.userName,
    };
  }

  /**
   * FR-004: resolves the requester's contract id (null for contract-less
   * users). Contract-less requesters see all eligible approvers.
   *
   * @param {string|null} requesterId
   */
  async resolveRequesterContract(requesterId) {
    if (!requesterId) return null;
    const requester = await this.userRepository.findById(requesterId);
    return requester?.contractTypeId ? String(requester.contractTypeId) : null;
  }

  /**
   * Builds the assignment + immutable configuration snapshot for a submission.
   * User-targets assign directly; role-targets stay claimable (assignedUserId
   * null) until an eligible approver claims them.
   *
   * @param {{ requestType: string, target: object, requesterId?: string|null, explicitTarget?: boolean }} input
   */
  async buildAssignment({ requestType, target, requesterId = null, explicitTarget = true }) {
    const validated = await this.validateTarget(requestType, target, { requesterId });
    const hierarchy = this.hierarchyService && requesterId
      ? await this.hierarchyService.getAncestorUsers(requesterId)
      : null;
    const hierarchyContext = hierarchy?.chart ? hierarchy : null;
    const contractTypeId = await this.resolveRequesterContract(requesterId);
    // Role-targeted requests must stay visible/claimable even when no
    // hierarchy chart exists. Without a chart the snapshot still needs the
    // eligible approvers for the configured target so the unified inbox
    // (which matches `eligibleApproverIds`) can surface the request.
    //
    // Explicit ROLE targets narrow to that role; auto-resolved targets keep
    // the same all-eligible behavior as claimApproval (explicitTarget=false).
    const fallbackRoleId =
      explicitTarget && validated.targetType === APPROVAL_TARGET_TYPES.ROLE
        ? validated.targetRoleId
        : null;
    const eligibleForSnapshot = hierarchyContext
      ? (await this.approvalConfigurationService.getEligibleUsers(requestType, null, {
        contractTypeId,
      })).filter((user) => hierarchyContext.ancestors.some((ancestor) => String(ancestor.userId) === String(user.userId)))
      : await this.approvalConfigurationService.getEligibleUsers(
        requestType,
        fallbackRoleId,
        { contractTypeId }
      );
    const snapshot = this.approvalConfigurationService.buildSnapshot({
      requestType,
      targetType: validated.targetType,
      targetRoleId: validated.targetRoleId,
      targetRoleName: validated.targetRoleName,
      targetRoleLevel: validated.targetRoleLevel,
      targetUserId: validated.targetUserId,
      targetUserName: validated.targetUserName,
      hierarchyId: hierarchyContext?.chart?.id ?? null,
      hierarchyVersion: hierarchyContext?.chart?.version ?? null,
      requesterNodeId: hierarchyContext?.requesterNode?.nodeId ?? null,
      ancestorChain: hierarchyContext?.ancestors ?? [],
      eligibleApproverIds: eligibleForSnapshot.map((user) => String(user.userId)),
      explicitTarget,
    });
    const assignedUserId =
      validated.targetType === APPROVAL_TARGET_TYPES.USER ? validated.targetUserId : null;
    return {
      targetType: validated.targetType,
      targetRoleId: validated.targetRoleId,
      targetUserId: validated.targetUserId,
      assignedUserId,
      status: APPROVAL_STATUS.PENDING,
      configurationSnapshot: snapshot,
    };
  }

  /**
   * FR-007: resolves the DEFAULT eligible ROLE target for a request type when
   * the requester supplied no explicit approval target. Picks the highest
   * approval-level configured role that is targetable (`canBeTarget`) and has
   * at least one eligible ACTIVE user (FR-004: scoped to the requester's
   * contract); returns null when no role qualifies so the legacy routing
   * fallback still applies.
   *
   * @param {string} requestType
   * @param {string|null} [requesterId]
   * @returns {Promise<{ targetType: string, targetRoleId: string } | null>}
   */
  async resolveDefaultTarget(requestType, requesterId = null) {
    if (this.hierarchyService && requesterId) {
      const hierarchy = await this.hierarchyService.getAncestorUsers(requesterId);
      if (hierarchy.chart) {
        const contractTypeId = await this.resolveRequesterContract(requesterId);
        const eligible = await this.approvalConfigurationService.getEligibleUsers(requestType, null, { contractTypeId });
        const first = hierarchy.ancestors.find((ancestor) => eligible.some((user) => String(user.userId) === String(ancestor.userId)));
        if (!first) return null;
        return { targetType: APPROVAL_TARGET_TYPES.USER, targetUserId: String(first.userId) };
      }
      if (hierarchy.requesterScoped && !hierarchy.chart) return null;
    }
    const contractTypeId = await this.resolveRequesterContract(requesterId);
    const eligibleRoles = await this.approvalConfigurationService.getEligibleRoles(requestType);
    const targetable = eligibleRoles
      .filter((role) => role.canBeTarget === true)
      .sort(
        (a, b) =>
          b.approvalLevel - a.approvalLevel || a.roleName.localeCompare(b.roleName)
      );
    for (const role of targetable) {
      const users = await this.approvalConfigurationService.getEligibleUsers(
        requestType,
        role.roleId,
        { contractTypeId }
      );
      if (users.length > 0) {
        return {
          targetType: APPROVAL_TARGET_TYPES.ROLE,
          targetRoleId: role.roleId,
        };
      }
    }
    return null;
  }

  /**
   * Builds the assignment for a submission: an explicit `approvalTarget` is
   * validated and assigned as-is; without one, FR-007 auto-resolves the default
   * eligible role target. Returns null only when no target is supplied AND no
   * eligible role exists (legacy auto-routing applies).
   *
   * @param {{ requestType: string, input: object, requesterId?: string|null }} params
   */
  async prepareSubmission({ requestType, input, requesterId = null }) {
    if (input?.approvalTarget) {
      return this.buildAssignment({ requestType, target: input.approvalTarget, requesterId, explicitTarget: true });
    }
    const defaultTarget = await this.resolveDefaultTarget(requestType, requesterId);
    if (defaultTarget) {
      return this.buildAssignment({ requestType, target: defaultTarget, requesterId, explicitTarget: false });
    }
    if (this.hierarchyService && requesterId) {
      const hierarchy = await this.hierarchyService.getAncestorUsers(requesterId);
      if (hierarchy.chart || hierarchy.requesterScoped) {
        throw new ValidationError(
          hierarchy.chart
            ? "Tidak ada approver yang eligible pada bagan hirarki. Perbaiki bagan hirarki terlebih dahulu."
            : "Requester belum memiliki bagan hirarki aktif. Perbaiki bagan hirarki terlebih dahulu.",
          { field: "approvalTarget" }
        );
      }
    }
    return null;
  }

  /**
   * Persists the assignment at submission and records the ASSIGNED event +
   * audit (agents.md §18).
   *
   * @param {string} requestId
   * @param {object} assignment from buildAssignment
   * @param {object} actor
   */
  async createApprovalAssignment(requestId, assignment, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    const updated = await this.requestRepository.updateStatus(request.id, {
      toStatus: request.status,
      version: request.version,
      fields: {
        approval: assignment,
        approverId: assignment.assignedUserId ?? null,
      },
    });

    await this.recordApprovalEvent(requestId, "ASSIGNED", actor, {
      targetType: assignment.targetType,
      assignedUserId: assignment.assignedUserId ?? null,
      requestType: request.type,
    });

    return updated;
  }

  /* -------------------------------------------------------------------------
   * Claiming (role-targeted) — FR-002/FR-010
   * ---------------------------------------------------------------------- */

  /**
   * Atomically claims a role-targeted PENDING request. Only one eligible user
   * can win (findOneAndUpdate on a null assignment).
   *
   * @param {string} requestId
   * @param {string} userId
   * @param {object} actor
   */
  async claimApproval(requestId, userId, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    if (!canClaim(request.approval, request.status)) {
      // Distinguish "already claimed by someone else" from "never claimable".
      if (request.approval?.assignedUserId) {
        throw new ConflictError(
          "This request was already claimed by another approver.",
          "REQUEST_ALREADY_CLAIMED"
        );
      }
      throw new ConflictError(
        "This request is not claimable (already assigned or decided).",
        "REQUEST_NOT_CLAIMABLE"
      );
    }
    // Eligibility: the claimant must be an eligible approver for the type,
    // scoped to the requester's contract (FR-004: same contract OR
    // contract-less approvers can claim).
    const contractTypeId = await this.resolveRequesterContract(request.requesterId);
    const eligibleUsers = await this.approvalConfigurationService.getEligibleUsers(
      request.type,
      request.approval?.configurationSnapshot?.explicitTarget === true
        ? request.approval?.targetRoleId ?? null
        : null,
      { contractTypeId }
    );
    const hierarchy = this.hierarchyService
      ? await this.hierarchyService.getAncestorUsers(request.requesterId)
      : null;
    const hierarchyEligible = hierarchy?.chart
      ? eligibleUsers.filter((user) => hierarchy.ancestors.some((ancestor) => String(ancestor.userId) === String(user.userId)))
      : eligibleUsers;
    if (!hierarchyEligible.some((u) => String(u.userId) === String(userId))) {
      throw new PermissionDeniedError(`${request.type.toLowerCase()}:approve`);
    }
    // No self-approval unless configured.
    const selfAllowed = await this.approvalConfigurationService.allowsSelfApproval(request.type);
    assertNoSelfApprovalUnlessAllowed(request.requesterId, userId, selfAllowed);

    const claimed = await this.requestRepository.claimForUser(request.id, userId);
    if (!claimed) {
      throw new ConflictError(
        "This request was already claimed by another approver.",
        "REQUEST_ALREADY_CLAIMED"
      );
    }

    await this.recordApprovalEvent(requestId, "CLAIMED", actor, {
      claimedBy: userId,
      requestType: request.type,
    });

    return this.requestService.toDto(claimed);
  }

  /* -------------------------------------------------------------------------
   * Decisions (approve / reject) — FR-002/FR-009
   * ---------------------------------------------------------------------- */

  /**
   * Approves a pending request. The actor must be the assigned approver (or an
   * admin override). Records approval fields + history + audit + event.
   *
   * @param {string} requestId
   * @param {object} actor { actorId, actorRoleKeys, actorPermissions, ... }
   */
  async approve(requestId, actor = {}) {
    return this.decide(requestId, REQUEST_STATUS.APPROVED, { comment: "" }, actor);
  }

  /**
   * Rejects a pending request. A non-blank rejection reason is MANDATORY
   * (agents.md §16/§29).
   *
   * @param {string} requestId
   * @param {string} reason
   * @param {object} actor
   */
  async reject(requestId, reason, actor = {}) {
    assertRejectionReason(reason);
    return this.decide(requestId, REQUEST_STATUS.REJECTED, { comment: reason }, actor);
  }

  /** Shared decision path for approve/reject. */
  async decide(requestId, toStatus, { comment = "" }, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    // Assignment: assigned approver (or effective admin override).
    const assignedUserId = request.approval?.assignedUserId ?? request.approverId ?? null;
    const isAssigned = assignedUserId && String(assignedUserId) === String(actor.actorId);
    const canOverride = canOverrideApprovals(actor);
    const isAdminOverride =
      (actor.actorRoleKeys ?? []).includes("HR_ADMIN") || canOverride;
    if (!isAssigned && !isAdminOverride) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }

    if (!isAdminOverride && this.hierarchyService) {
      const hierarchy = await this.hierarchyService.getAncestorUsers(request.requesterId);
      if (hierarchy.chart && !hierarchy.ancestors.some((user) => String(user.userId) === String(actor.actorId))) {
        throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
      }
    }

    // Permission for the request's type (defense in depth behind the route).
    // The explicit company-wide override capability supersedes the per-type
    // key — it is a granted, auditable privilege.
    const permissionKey = `${request.type.toLowerCase()}:approve`;
    if (!canOverride && !hasPermission(actor.actorPermissions ?? [], permissionKey)) {
      throw new PermissionDeniedError(permissionKey);
    }

    // Self-approval guard (agents.md §29; config may allow it).
    const selfAllowed = await this.approvalConfigurationService.allowsSelfApproval(request.type);
    assertNoSelfApprovalUnlessAllowed(request.requesterId, actor.actorId, selfAllowed);

    const now = new Date();
    // An admin override of an unclaimed request becomes the assignment, so
    // the audit trail names the actual decision-maker (mirrors
    // ApprovalService.decide).
    const assignmentFields = request.approval?.assignedUserId
      ? {}
      : { assignedUserId: actor.actorId ?? null, assignedAt: now };
    const approvalFields =
      toStatus === REQUEST_STATUS.APPROVED
        ? {
            ...assignmentFields,
            status: APPROVAL_STATUS.APPROVED,
            approvedBy: actor.actorId,
            approvedAt: now,
          }
        : {
            ...assignmentFields,
            status: APPROVAL_STATUS.REJECTED,
            rejectedBy: actor.actorId,
            rejectedAt: now,
            rejectionReason: comment,
          };

    const decided = await this.requestService.transition({
      requestId,
      toStatus,
      actor,
      comment,
      approvalFields,
    });

    return decided;
  }

  /* -------------------------------------------------------------------------
   * History
   * ---------------------------------------------------------------------- */

  /** Append-only approval timeline for a request (agents.md §18). */
  async getApprovalHistory(requestId, actor = {}) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    const isRequester = String(request.requesterId) === String(actor.actorId);
    const isAssigned = request.approval?.assignedUserId &&
      String(request.approval.assignedUserId) === String(actor.actorId);
    const isAdmin = (actor.actorRoleKeys ?? []).includes("HR_ADMIN") ||
      canOverrideApprovals(actor);
    if (!isRequester && !isAssigned && !isAdmin) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    const events = await this.requestEventRepository.findByRequestId(requestId);
    return { request: this.requestService.toDto(request), events: events.map((e) => this.requestService.toEventDto(e)) };
  }

  /* -------------------------------------------------------------------------
   * Shared helpers
   * ---------------------------------------------------------------------- */

  /** Records an approval lifecycle event (ASSIGNED/CLAIMED) + audit + bus. */
  async recordApprovalEvent(requestId, event, actor, metadata = {}) {
    // FR-009: immutable actor/role name snapshot for the history timeline.
    let snapshot = { actorNameSnapshot: null, actorRoleId: null, actorRoleNameSnapshot: null };
    if (actor.actorId) {
      const user = await this.userRepository.findById(actor.actorId);
      if (user) {
        const roleIds = await this.userRoleRepository.roleIdsForUser(actor.actorId);
        const roles = roleIds.length ? await this.roleRepository.findByIds(roleIds) : [];
        const first = roles[0];
        snapshot = {
          actorNameSnapshot: user.name ?? user.username ?? null,
          actorRoleId: first?.id ?? first?._id ?? null,
          actorRoleNameSnapshot: first?.name ?? null,
        };
      }
    }
    await this.requestEventRepository.append({
      requestId,
      event,
      actorId: actor.actorId ?? null,
      ...snapshot,
      comment: "",
      fromStatus: REQUEST_STATUS.PENDING,
      toStatus: REQUEST_STATUS.PENDING,
    });
    await this.auditService.record({
      action: event === "CLAIMED" ? "REQUEST.CLAIMED" : "REQUEST.ASSIGNED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "REQUEST", id: requestId, summary: `${event.toLowerCase()} approval target` },
      outcome: "SUCCESS",
      metadata: { requestId, ...metadata },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await this.eventBus.publish(
      event === "CLAIMED" ? "request.claimed" : "request.assigned",
      { requestId, ...metadata }
    );
  }
}

module.exports = { ApprovalEngineService };
