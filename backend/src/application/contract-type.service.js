/**
 * ContractTypeService (NEW UPDATE TAD SIMBIKA) — master data for employee
 * contract types: admin CRUD + activate/deactivate, plus the active list for
 * user forms. Mutations are audited (SETTINGS.CHANGED).
 */

const {
  CONTRACT_TYPE_STATUS,
  validateContractTypeInput,
  isActiveContractType,
} = require("../domain/contract-type");
const { ValidationError, ConflictError, NotFoundError } = require("../domain/errors");

class ContractTypeService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/contract-type.repository').ContractTypeRepository} deps.contractTypeRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ contractTypeRepository, auditService }) {
    this.contractTypeRepository = contractTypeRepository;
    this.auditService = auditService;
  }

  /** Active types usable on user forms. */
  async listActive() {
    const items = await this.contractTypeRepository.listActive();
    return items.map((t) => this.toDto(t));
  }

  /** Admin list with search + status filter. */
  async list({ search, status } = {}) {
    const items = await this.contractTypeRepository.list({ search, status });
    return items.map((t) => this.toDto(t));
  }

  /**
   * Admin creates a contract type (active).
   *
   * @param {{ key: string, name: string, description?: string }} input
   * @param {object} actor
   */
  async create(input, actor = {}) {
    validateContractTypeInput(input);
    if (await this.contractTypeRepository.findByKey(input.key)) {
      throw new ConflictError("Contract type exists.", "CONTRACT_TYPE_EXISTS");
    }
    const created = await this.contractTypeRepository.create({
      ...input,
      status: CONTRACT_TYPE_STATUS.ACTIVE,
    });
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "CONTRACT_TYPE", id: created.id, summary: created.key },
      outcome: "SUCCESS",
      metadata: { changedFields: ["contractType"], kind: "create" },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(created);
  }

  /** Admin updates a contract type (name/description). */
  async update(id, input, actor = {}) {
    const updated = await this.contractTypeRepository.update(id, {
      name: input.name,
      description: input.description,
      updatedBy: actor.actorId ?? null,
    });
    if (!updated) throw new NotFoundError("Contract type not found.", "CONTRACT_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin activates a contract type. */
  async activate(id, actor = {}) {
    const updated = await this.contractTypeRepository.setStatus(
      id,
      CONTRACT_TYPE_STATUS.ACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Contract type not found.", "CONTRACT_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin deactivates a contract type (history preserved). */
  async deactivate(id, actor = {}) {
    const updated = await this.contractTypeRepository.setStatus(
      id,
      CONTRACT_TYPE_STATUS.INACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Contract type not found.", "CONTRACT_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** True when the type is registered + ACTIVE (used by user assignment). */
  async isActiveType(id) {
    let doc = null;
    try {
      doc = await this.contractTypeRepository.getById(id);
    } catch {
      return false;
    }
    return isActiveContractType(doc);
  }

  /** Null-safe type lookup used to resolve display names. */
  async findById(id) {
    try {
      return await this.contractTypeRepository.getById(id);
    } catch {
      return null;
    }
  }

  toDto(type) {
    return {
      id: type.id,
      key: type.key,
      name: type.name,
      description: type.description ?? "",
      status: type.status,
      updatedAt: type.updatedAt ?? null,
    };
  }
}

module.exports = { ContractTypeService };
