/**
 * SicknessTypeService (TODO.md §5) — master data for Sickness types, plus the
 * controlled "Tambahkan sendiri" suggestion flow (§6): requesters suggest a new
 * type (status PENDING); an authorized administrator activates it. RBAC is
 * preserved — ordinary users never gain unrestricted master-data access.
 */

const {
  SICKNESS_TYPE_STATUS,
  validateSicknessTypeInput,
  isActiveSicknessType,
} = require("../domain/sickness-type");
const { ValidationError, ConflictError, NotFoundError } = require("../domain/errors");

class SicknessTypeService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/sickness-type.repository').SicknessTypeRepository} deps.sicknessTypeRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ sicknessTypeRepository, auditService }) {
    this.sicknessTypeRepository = sicknessTypeRepository;
    this.auditService = auditService;
  }

  /** Active types usable on the submission form. */
  async listActive() {
    const items = await this.sicknessTypeRepository.listActive();
    return items.map((t) => this.toDto(t));
  }

  /** Admin list with search + status filter. */
  async list({ search, status } = {}) {
    const items = await this.sicknessTypeRepository.list({ search, status });
    return items.map((t) => this.toDto(t));
  }

  /**
   * Admin creates a type directly (active).
   *
   * @param {{ key: string, name: string, description?: string }} input
   * @param {object} actor
   */
  async create(input, actor = {}) {
    validateSicknessTypeInput(input);
    if (await this.sicknessTypeRepository.findByKey(input.key)) {
      throw new ConflictError("Sickness type exists.", "SICKNESS_TYPE_EXISTS");
    }
    const created = await this.sicknessTypeRepository.create({
      ...input,
      status: SICKNESS_TYPE_STATUS.ACTIVE,
    });
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SICKNESS_TYPE", id: created.id, summary: created.key },
      outcome: "SUCCESS",
      metadata: { changedFields: ["sicknessType"], kind: "create" },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(created);
  }

  /**
   * FR-006 "Tambahkan sendiri": a requester suggests a new sickness type. It
   * is created as PENDING and only becomes usable after an administrator
   * activates it. If the suggested key already exists as PENDING/ACTIVE, the
   * existing record is returned (no duplicate spam).
   *
   * @param {{ key?: string, name: string, description?: string }} input
   * @param {object} actor
   */
  async suggest(input, actor = {}) {
    const key = (input.key ?? input.name).trim().toUpperCase().replace(/\s+/g, "_");
    validateSicknessTypeInput({ key, name: input.name });
    const existing = await this.sicknessTypeRepository.findByKey(key);
    if (existing) {
      return this.toDto(existing);
    }
    const created = await this.sicknessTypeRepository.create({
      key,
      name: input.name.trim(),
      description: input.description ?? "",
      status: SICKNESS_TYPE_STATUS.PENDING,
      suggestedBy: actor.actorId ?? null,
    });
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SICKNESS_TYPE", id: created.id, summary: created.key },
      outcome: "SUCCESS",
      metadata: { changedFields: ["sicknessType"], kind: "suggest", status: "PENDING" },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(created);
  }

  /** Admin updates a type (name/description). */
  async update(id, input, actor = {}) {
    const updated = await this.sicknessTypeRepository.update(id, {
      name: input.name,
      description: input.description,
      updatedBy: actor.actorId ?? null,
    });
    if (!updated) throw new NotFoundError("Sickness type not found.", "SICKNESS_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin activates a type (including PENDING suggestions). */
  async activate(id, actor = {}) {
    const updated = await this.sicknessTypeRepository.setStatus(
      id,
      SICKNESS_TYPE_STATUS.ACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Sickness type not found.", "SICKNESS_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin deactivates a type (history preserved). */
  async deactivate(id, actor = {}) {
    const updated = await this.sicknessTypeRepository.setStatus(
      id,
      SICKNESS_TYPE_STATUS.INACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Sickness type not found.", "SICKNESS_TYPE_NOT_FOUND");
    return this.toDto(updated);
  }

  /** True when the type is registered + ACTIVE (used by Sakit submission). */
  async isActiveType(id) {
    let doc = null;
    try {
      doc = await this.sicknessTypeRepository.getById(id);
    } catch {
      // Unknown id must resolve to "not an active type" (business 400 on
      // submission) instead of leaking a 404 from the repository.
      return false;
    }
    return isActiveSicknessType(doc);
  }

  /** Null-safe type lookup used to resolve display names for summaries. */
  async findById(id) {
    try {
      return await this.sicknessTypeRepository.getById(id);
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
      isSystem: type.isSystem ?? false,
      suggestedBy: type.suggestedBy?.toString?.() ?? null,
      updatedAt: type.updatedAt ?? null,
    };
  }
}

module.exports = { SicknessTypeService };
