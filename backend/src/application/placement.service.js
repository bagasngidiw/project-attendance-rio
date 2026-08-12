/**
 * PlacementService (NEW UPDATE TAD SIMBIKA) — master data for employee
 * placements: admin CRUD + activate/deactivate, plus the active list for user
 * forms. Mutations are audited (SETTINGS.CHANGED).
 */

const {
  PLACEMENT_STATUS,
  validatePlacementInput,
  isActivePlacement,
} = require("../domain/placement");
const { ConflictError, NotFoundError } = require("../domain/errors");

class PlacementService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/placement.repository').PlacementRepository} deps.placementRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ placementRepository, auditService }) {
    this.placementRepository = placementRepository;
    this.auditService = auditService;
  }

  /** Active placements usable on user forms. */
  async listActive() {
    const items = await this.placementRepository.listActive();
    return items.map((t) => this.toDto(t));
  }

  /** Admin list with search + status filter. */
  async list({ search, status } = {}) {
    const items = await this.placementRepository.list({ search, status });
    return items.map((t) => this.toDto(t));
  }

  /**
   * Admin creates a placement (active).
   *
   * @param {{ key: string, name: string, description?: string }} input
   * @param {object} actor
   */
  async create(input, actor = {}) {
    validatePlacementInput(input);
    if (await this.placementRepository.findByKey(input.key)) {
      throw new ConflictError("Placement exists.", "PLACEMENT_EXISTS");
    }
    const created = await this.placementRepository.create({
      ...input,
      status: PLACEMENT_STATUS.ACTIVE,
    });
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "PLACEMENT", id: created.id, summary: created.key },
      outcome: "SUCCESS",
      metadata: { changedFields: ["placement"], kind: "create" },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(created);
  }

  /** Admin updates a placement (name/description). */
  async update(id, input, actor = {}) {
    const updated = await this.placementRepository.update(id, {
      name: input.name,
      description: input.description,
      updatedBy: actor.actorId ?? null,
    });
    if (!updated) throw new NotFoundError("Placement not found.", "PLACEMENT_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin activates a placement. */
  async activate(id, actor = {}) {
    const updated = await this.placementRepository.setStatus(
      id,
      PLACEMENT_STATUS.ACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Placement not found.", "PLACEMENT_NOT_FOUND");
    return this.toDto(updated);
  }

  /** Admin deactivates a placement (history preserved). */
  async deactivate(id, actor = {}) {
    const updated = await this.placementRepository.setStatus(
      id,
      PLACEMENT_STATUS.INACTIVE,
      actor.actorId ?? null
    );
    if (!updated) throw new NotFoundError("Placement not found.", "PLACEMENT_NOT_FOUND");
    return this.toDto(updated);
  }

  /** True when the placement is registered + ACTIVE (used by user assignment). */
  async isActiveType(id) {
    let doc = null;
    try {
      doc = await this.placementRepository.getById(id);
    } catch {
      return false;
    }
    return isActivePlacement(doc);
  }

  /** Null-safe placement lookup used to resolve display names. */
  async findById(id) {
    try {
      return await this.placementRepository.getById(id);
    } catch {
      return null;
    }
  }

  toDto(placement) {
    return {
      id: placement.id,
      key: placement.key,
      name: placement.name,
      description: placement.description ?? "",
      status: placement.status,
      updatedAt: placement.updatedAt ?? null,
    };
  }
}

module.exports = { PlacementService };
