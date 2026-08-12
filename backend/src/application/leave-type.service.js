/**
 * LeaveTypeService — leave-type configuration (FR-058). CRUD + active list +
 * registration check. Changes are recorded as SETTINGS.CHANGED (audited).
 */

const {
  validateLeaveTypeInput,
  isActiveLeaveType,
} = require("../domain/leave-type");

class LeaveTypeService {
  /**
   * @param {import('../infrastructure/repositories/leave-type.repository').LeaveTypeRepository} deps.leaveTypeRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ leaveTypeRepository, auditService }) {
    this.leaveTypeRepository = leaveTypeRepository;
    this.auditService = auditService;
  }

  /** Active leave types for the submission form. */
  async listActive() {
    const items = await this.leaveTypeRepository.listActive();
    return items.map((item) => this.toDto(item));
  }

  /** All leave types (admin surface). */
  async listAll() {
    const items = await this.leaveTypeRepository.listAll();
    return items.map((item) => this.toDto(item));
  }

  /** True when the leave type exists and is ACTIVE (submission guard). */
  async isActiveType(idOrKey) {
    // Accept both a registered type id and a legacy/system key so the
    // submission form (id) and existing callers (key, e.g. "ANNUAL") agree.
    const entity =
      (await this.leaveTypeRepository.findByKey(idOrKey)) ??
      (await this.leaveTypeRepository.findById(idOrKey));
    return isActiveLeaveType(entity);
  }

  /** Null-safe type lookup used to resolve display names for summaries. */
  async findById(id) {
    return this.leaveTypeRepository.findById(id);
  }

  async create(input, actor = {}) {
    validateLeaveTypeInput(input);
    const entity = await this.leaveTypeRepository.create({
      key: input.key,
      name: input.name.trim(),
      description: input.description ?? "",
      isBalanceBased: input.isBalanceBased ?? false,
      maxDaysPerRequest: input.maxDaysPerRequest ?? null,
      requiredSupportingInfo: input.requiredSupportingInfo ?? false,
      isSystem: false,
      updatedBy: actor.actorId ?? null,
    });
    await this.recordChange(entity, actor, { action: "create" });
    return this.toDto(entity);
  }

  /**
   * TODO.md §6 "Tambahkan sendiri": a requester suggests a new Cuti type. It
   * is created as PENDING and only becomes usable after an administrator
   * activates it. If the derived key already exists, the existing record is
   * returned (no duplicate spam).
   *
   * @param {{ key?: string, name: string, description?: string }} input
   * @param {object} actor
   */
  async suggest(input, actor = {}) {
    const key = (input.key ?? input.name).trim().toUpperCase().replace(/\s+/g, "_");
    validateLeaveTypeInput({ key, name: input.name });
    const existing = await this.leaveTypeRepository.findByKey(key);
    if (existing) {
      return this.toDto(existing);
    }
    const entity = await this.leaveTypeRepository.create({
      key,
      name: input.name.trim(),
      description: input.description ?? "",
      isBalanceBased: false,
      maxDaysPerRequest: null,
      requiredSupportingInfo: false,
      isSystem: false,
      status: "PENDING",
      updatedBy: actor.actorId ?? null,
    });
    await this.recordChange(entity, actor, { action: "suggest" });
    return this.toDto(entity);
  }

  async update(id, input, actor = {}) {
    const current = await this.leaveTypeRepository.getById(id);
    const next = {
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      isBalanceBased: input.isBalanceBased ?? current.isBalanceBased,
      maxDaysPerRequest: input.maxDaysPerRequest ?? current.maxDaysPerRequest,
      requiredSupportingInfo: input.requiredSupportingInfo ?? current.requiredSupportingInfo,
      updatedBy: actor.actorId ?? null,
    };
    validateLeaveTypeInput({ key: current.key, name: next.name, maxDaysPerRequest: next.maxDaysPerRequest });
    const updated = await this.leaveTypeRepository.update(id, next);
    await this.recordChange(updated, actor, { action: "update" });
    return this.toDto(updated);
  }

  async deactivate(id, actor = {}) {
    const updated = await this.leaveTypeRepository.setStatus(id, "INACTIVE", actor.actorId ?? null);
    if (!updated) {
      const { NotFoundError } = require("../domain/errors");
      throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    }
    await this.recordChange(updated, actor, { action: "deactivate" });
    return this.toDto(updated);
  }

  async activate(id, actor = {}) {
    const updated = await this.leaveTypeRepository.setStatus(id, "ACTIVE", actor.actorId ?? null);
    if (!updated) {
      const { NotFoundError } = require("../domain/errors");
      throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    }
    await this.recordChange(updated, actor, { action: "activate" });
    return this.toDto(updated);
  }

  async recordChange(entity, actor, { action }) {
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "LEAVE_TYPE", id: entity.id ?? entity._id, summary: entity.key },
      outcome: "SUCCESS",
      metadata: { setting: `leave-type.${entity.key}`, action, key: entity.key },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }

  toDto(entity) {
    return {
      id: String(entity.id ?? entity._id),
      key: entity.key,
      name: entity.name,
      description: entity.description ?? "",
      isBalanceBased: entity.isBalanceBased ?? false,
      maxDaysPerRequest: entity.maxDaysPerRequest ?? null,
      requiredSupportingInfo: entity.requiredSupportingInfo ?? false,
      status: entity.status,
      isSystem: entity.isSystem ?? false,
    };
  }
}

module.exports = { LeaveTypeService };
