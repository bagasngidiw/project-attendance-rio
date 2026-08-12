/**
 * FilterPresetService (FR-047) — saved filter presets for lists and reports.
 *
 * Presets are owner-scoped and authenticated-only: every mutation is guarded
 * by ownership (non-owners receive a NotFoundError, so existence is not
 * leaked) and recorded as an audit event. Re-running a preset simply re-applies
 * the stored `filters` object — see rerunPreset; presets are immutable
 * templates and re-running never mutates the stored copy.
 */

const { validateFilterPreset } = require("../domain/filter-preset");
const { NotFoundError } = require("../domain/errors");

class FilterPresetService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/filter-preset.repository').FilterPresetRepository} deps.filterPresetRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ filterPresetRepository, auditService }) {
    this.filterPresetRepository = filterPresetRepository;
    this.auditService = auditService;
  }

  /**
   * Creates a preset for the caller (authenticated-only, no special
   * permission). Records FILTER_PRESET.CREATED.
   *
   * @param {{ ownerId: string, input: { name: string, route: string, filters: object }, actor: object }} params
   */
  async createPreset({ ownerId, input, actor = {} }) {
    const validated = validateFilterPreset(input);
    const preset = await this.filterPresetRepository.create({
      ownerId,
      ...validated,
    });

    await this.auditService.record({
      action: "FILTER_PRESET.CREATED",
      actor: { userId: ownerId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "FILTER_PRESET",
        id: preset.id ?? preset._id,
        summary: `Filter preset "${preset.name}" created`,
      },
      outcome: "SUCCESS",
      metadata: { name: preset.name, route: preset.route },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(preset);
  }

  /**
   * Owner-scoped list, newest first, optional route filter.
   *
   * @param {string} ownerId
   * @param {{ route?: string, page?: number, pageSize?: number }} options
   */
  async listPresets(ownerId, { route, page = 1, pageSize = 20 } = {}) {
    const { items, total } = await this.filterPresetRepository.listByOwner(
      ownerId,
      { route, page, pageSize }
    );
    return {
      items: items.map((item) => this.toDto(item)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Owner-scoped single preset (used to apply it).
   *
   * @param {string} id
   * @param {string} ownerId
   */
  async getByIdScoped(id, ownerId) {
    const preset = await this.filterPresetRepository.findByIdScoped(id, ownerId);
    if (!preset) {
      throw new NotFoundError(
        "Filter preset not found.",
        "FILTER_PRESET_NOT_FOUND"
      );
    }
    return this.toDto(preset);
  }

  /**
   * Re-runs a preset: returns the stored `route` + `filters` so the consumer
   * re-issues the underlying report/list query with them. The stored preset is
   * never mutated by re-running it (FR-047).
   *
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<{ route: string, filters: object }>}
   */
  async rerunPreset(id, ownerId) {
    const preset = await this.getByIdScoped(id, ownerId);
    return { route: preset.route, filters: preset.filters };
  }

  /**
   * Updates a preset owned by the caller (owner-only). The resulting preset is
   * re-validated as a whole; records FILTER_PRESET.UPDATED.
   *
   * @param {{ id: string, ownerId: string, patch: object, actor: object }} params
   */
  async updatePreset({ id, ownerId, patch = {}, actor = {} }) {
    const existing = await this.filterPresetRepository.findByIdScoped(id, ownerId);
    if (!existing) {
      throw new NotFoundError(
        "Filter preset not found.",
        "FILTER_PRESET_NOT_FOUND"
      );
    }

    const next = validateFilterPreset({
      name: patch.name ?? existing.name,
      route: patch.route ?? existing.route,
      filters: patch.filters ?? existing.filters,
    });

    const updated = await this.filterPresetRepository.update(id, ownerId, next);

    await this.auditService.record({
      action: "FILTER_PRESET.UPDATED",
      actor: { userId: ownerId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "FILTER_PRESET",
        id: id ?? existing._id,
        summary: `Filter preset "${next.name}" updated`,
      },
      outcome: "SUCCESS",
      metadata: { name: next.name, route: next.route },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(updated ?? next);
  }

  /**
   * Deletes a preset owned by the caller (owner-only); records
   * FILTER_PRESET.DELETED and returns the removed preset.
   *
   * @param {{ id: string, ownerId: string, actor: object }} params
   */
  async deletePreset({ id, ownerId, actor = {} }) {
    const existing = await this.filterPresetRepository.findByIdScoped(id, ownerId);
    if (!existing) {
      throw new NotFoundError(
        "Filter preset not found.",
        "FILTER_PRESET_NOT_FOUND"
      );
    }

    await this.filterPresetRepository.delete(id, ownerId);

    await this.auditService.record({
      action: "FILTER_PRESET.DELETED",
      actor: { userId: ownerId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "FILTER_PRESET",
        id: id ?? existing._id,
        summary: `Filter preset "${existing.name}" deleted`,
      },
      outcome: "SUCCESS",
      metadata: { name: existing.name, route: existing.route },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toDto(existing);
  }

  /** Normalizes a preset document into a DTO. */
  toDto(preset) {
    const id = preset.id ?? preset._id;
    return {
      id: String(id),
      ownerId: preset.ownerId?.toString?.() ?? preset.ownerId,
      name: preset.name,
      route: preset.route,
      filters: preset.filters ?? {},
      createdAt: preset.createdAt ?? null,
      updatedAt: preset.updatedAt ?? null,
    };
  }
}

module.exports = { FilterPresetService };
