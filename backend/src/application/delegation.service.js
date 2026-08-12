/**
 * DelegationService (FR-009) — the application surface for approval
 * delegation. Creates and revokes delegations (audited), lists a delegator's
 * own delegations, and resolves the *effective* approver for a request so the
 * approval pipeline can honor active delegations.
 */

const {
  validateDelegation,
  delegationCovers,
  DELEGATION_STATUS,
} = require("../domain/delegation");
const { NotFoundError, ConflictError } = require("../domain/errors");

class DelegationService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/delegation.repository').DelegationRepository} deps.delegationRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ delegationRepository, userRepository, auditService }) {
    this.delegationRepository = delegationRepository;
    this.userRepository = userRepository;
    this.auditService = auditService;
  }

  /**
   * Creates an approval delegation after domain validation.
   *
   * @param {{ delegatorId: string, input: { delegateId: string, requestTypes?: string[], startsAt: string, endsAt: string }, actor: object }} params
   */
  async createDelegation({ delegatorId, input, actor = {} }) {
    const delegate = await this.userRepository.findById(input.delegateId);
    const validated = validateDelegation(
      { ...input, delegatorId },
      {
        isSamePerson: String(delegatorId) === String(input.delegateId),
        delegateIsActive: delegate?.status === "ACTIVE",
      }
    );

    const created = await this.delegationRepository.create(validated);
    const id = this.idOf(created);

    await this.auditService.record({
      action: "DELEGATION.CREATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "DELEGATION",
        id,
        summary: `${validated.delegatorId} delegated approval to ${validated.delegateId}`,
      },
      outcome: "SUCCESS",
      metadata: {
        delegationId: id,
        delegatorId: validated.delegatorId,
        delegateId: validated.delegateId,
        requestTypes: validated.requestTypes,
        startsAt: validated.startsAt.toISOString(),
        endsAt: validated.endsAt.toISOString(),
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(created);
  }

  /**
   * Revokes a delegation. Owner-scoped: only the delegator (who must also
   * hold delegation:manage via the route) may revoke; others get a 404 so the
   * record's existence never leaks.
   *
   * @param {{ id: string, delegatorId: string, actor: object }} params
   */
  async revokeDelegation({ id, delegatorId, actor = {} }) {
    const delegation = await this.delegationRepository.findById(id);
    if (!delegation || String(delegation.delegatorId) !== String(delegatorId)) {
      throw new NotFoundError("Delegation not found.", "DELEGATION_NOT_FOUND");
    }
    if (delegation.status !== DELEGATION_STATUS.ACTIVE) {
      throw new ConflictError(
        "This delegation is already revoked.",
        "DELEGATION_ALREADY_REVOKED"
      );
    }

    const revoked = await this.delegationRepository.revoke(id, {
      revokedBy: delegatorId,
    });
    const revokedId = this.idOf(revoked);

    await this.auditService.record({
      action: "DELEGATION.REVOKED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "DELEGATION",
        id: revokedId,
        summary: `${delegatorId} revoked delegation for ${delegation.delegateId}`,
      },
      outcome: "SUCCESS",
      metadata: {
        delegationId: revokedId,
        delegatorId: delegatorId,
        delegateId: delegation.delegateId,
        revokedBy: delegatorId,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(revoked);
  }

  /** Delegations created by the caller, newest first (owner scope). */
  async listMyDelegations(delegatorId) {
    const items = await this.delegationRepository.findByDelegator(delegatorId);
    return { items: items.map((d) => this.toDto(d)), total: items.length };
  }

  /**
   * FR-063: ACTIVE delegations currently granted TO a delegate — used by the
   * unified approval inbox to include requests delegated to the caller.
   *
   * @param {string} delegateId
   * @returns {Promise<Array>} active delegations where delegateId matches
   */
  async listDelegationsForDelegate(delegateId) {
    return this.delegationRepository.findActiveByDelegate(delegateId);
  }

  /**
   * Resolves who may currently act for an approver on a request: the delegate
   * when an ACTIVE delegation covers the type/date window, otherwise the
   * approver themselves.
   *
   * @param {{ approverId: string, requestType?: string, date?: string|Date }} params
   * @returns {Promise<{ effectiveApproverId: string, delegated: boolean, delegationId: string|null }>}
   */
  async resolveEffectiveApprover({ approverId, requestType, date }) {
    const onDate = date ? new Date(date) : new Date();
    const delegations = await this.delegationRepository.findActiveForDelegator(
      approverId,
      onDate
    );

    for (const delegation of delegations) {
      if (delegationCovers(delegation, { requestType, date: onDate })) {
        return {
          effectiveApproverId: String(delegation.delegateId),
          delegated: true,
          delegationId: this.idOf(delegation),
        };
      }
    }

    return { effectiveApproverId: approverId, delegated: false, delegationId: null };
  }

  idOf(delegation) {
    return String(delegation.id ?? delegation._id);
  }

  toDto(delegation) {
    return {
      id: this.idOf(delegation),
      delegatorId: String(delegation.delegatorId),
      delegateId: String(delegation.delegateId),
      requestTypes: delegation.requestTypes ?? [],
      startsAt: delegation.startsAt ?? null,
      endsAt: delegation.endsAt ?? null,
      status: delegation.status,
      revokedAt: delegation.revokedAt ?? null,
      revokedBy: delegation.revokedBy ?? null,
      createdAt: delegation.createdAt ?? null,
    };
  }
}

module.exports = { DelegationService };
