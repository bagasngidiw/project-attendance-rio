/**
 * OrgService — organizational structure management (FR-024): departments and
 * positions CRUD with validation, duplicate-name rejection, and audited
 * lifecycle. Deactivation is data-preserving; active-only pickers exclude
 * deactivated entries.
 */

const {
  assertOrgName,
  assertOrgCode,
  assertDescription,
  ORG_STATUS,
} = require("../domain/organization");
const { NotFoundError } = require("../domain/errors");

const AUDIT_ACTION = {
  department: {
    create: "ORG.DEPARTMENT_CREATED",
    update: "ORG.DEPARTMENT_UPDATED",
    deactivate: "ORG.DEPARTMENT_DEACTIVATED",
    activate: "ORG.DEPARTMENT_ACTIVATED",
  },
  position: {
    create: "ORG.POSITION_CREATED",
    update: "ORG.POSITION_UPDATED",
    deactivate: "ORG.POSITION_DEACTIVATED",
    activate: "ORG.POSITION_ACTIVATED",
  },
};

class OrgService {
  /**
   * @param {import('../infrastructure/repositories/org.repository').OrgRepository} deps.orgRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ orgRepository, auditService }) {
    this.orgRepository = orgRepository;
    this.auditService = auditService;
  }

  /* ---------------- Departments ---------------- */

  async listDepartments() {
    const items = await this.orgRepository.listDepartments();
    return items.map((item) => this.toDto(item));
  }

  async listActiveDepartments() {
    const items = await this.orgRepository.listActiveDepartments();
    return items.map((item) => this.toDto(item));
  }

  async createDepartment(input, actor = {}) {
    const name = assertOrgName(input.name);
    const code = assertOrgCode(input.code);
    const description = assertDescription(input.description);
    const department = await this.orgRepository.createDepartment({
      name,
      code,
      description,
      createdBy: actor.actorId ?? null,
    });
    await this.recordOrg("department", "create", department, actor, { name, code });
    return this.toDto(department);
  }

  async updateDepartment(id, input, actor = {}) {
    const department = await this.orgRepository.getDepartment(id);
    const name = assertOrgName(input.name ?? department.name);
    const code = assertOrgCode(input.code);
    const description = assertDescription(input.description);
    const updated = await this.orgRepository.updateDepartment(id, {
      name,
      code,
      description,
      updatedBy: actor.actorId ?? null,
    });
    await this.recordOrg("department", "update", updated, actor, { name, code });
    return this.toDto(updated);
  }

  async deactivateDepartment(id, actor = {}) {
    const updated = await this.orgRepository.setDepartmentStatus(id, ORG_STATUS.INACTIVE, actor.actorId ?? null);
    if (!updated) throw new NotFoundError("Department not found.", "DEPARTMENT_NOT_FOUND");
    await this.recordOrg("department", "deactivate", updated, actor, {});
    return this.toDto(updated);
  }

  async activateDepartment(id, actor = {}) {
    const updated = await this.orgRepository.setDepartmentStatus(id, ORG_STATUS.ACTIVE, actor.actorId ?? null);
    if (!updated) throw new NotFoundError("Department not found.", "DEPARTMENT_NOT_FOUND");
    await this.recordOrg("department", "activate", updated, actor, {});
    return this.toDto(updated);
  }

  /* ---------------- Positions ---------------- */

  async listPositions() {
    const items = await this.orgRepository.listPositions();
    return items.map((item) => this.toDto(item));
  }

  async listActivePositions() {
    const items = await this.orgRepository.listActivePositions();
    return items.map((item) => this.toDto(item));
  }

  async createPosition(input, actor = {}) {
    const name = assertOrgName(input.name);
    const description = assertDescription(input.description);
    const position = await this.orgRepository.createPosition({
      name,
      description,
      createdBy: actor.actorId ?? null,
    });
    await this.recordOrg("position", "create", position, actor, { name });
    return this.toDto(position);
  }

  async updatePosition(id, input, actor = {}) {
    const position = await this.orgRepository.getPosition(id);
    const name = assertOrgName(input.name ?? position.name);
    const description = assertDescription(input.description);
    const updated = await this.orgRepository.updatePosition(id, {
      name,
      description,
      updatedBy: actor.actorId ?? null,
    });
    await this.recordOrg("position", "update", updated, actor, { name });
    return this.toDto(updated);
  }

  async deactivatePosition(id, actor = {}) {
    const updated = await this.orgRepository.setPositionStatus(id, ORG_STATUS.INACTIVE, actor.actorId ?? null);
    if (!updated) throw new NotFoundError("Position not found.", "POSITION_NOT_FOUND");
    await this.recordOrg("position", "deactivate", updated, actor, {});
    return this.toDto(updated);
  }

  async activatePosition(id, actor = {}) {
    const updated = await this.orgRepository.setPositionStatus(id, ORG_STATUS.ACTIVE, actor.actorId ?? null);
    if (!updated) throw new NotFoundError("Position not found.", "POSITION_NOT_FOUND");
    await this.recordOrg("position", "activate", updated, actor, {});
    return this.toDto(updated);
  }

  /* ---------------- Shared ---------------- */

  async recordOrg(kind, operation, entity, actor, extra) {
    await this.auditService.record({
      action: AUDIT_ACTION[kind][operation],
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: kind.toUpperCase(), id: entity.id, summary: entity.name },
      outcome: "SUCCESS",
      metadata: { name: entity.name, status: entity.status, ...extra },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }

  toDto(entity) {
    return {
      id: entity.id ?? entity._id,
      name: entity.name,
      code: entity.code ?? "",
      description: entity.description ?? "",
      status: entity.status,
    };
  }
}

module.exports = { OrgService };
