/**
 * PendingSummaryService — aggregates pending-request counts for a set of
 * users across HR modules (FR-006 team overview).
 *
 * Request modules (leave, overtime, business trip, attendance corrections)
 * register a provider per module via `registerProvider`. The team overview
 * asks for one summary over all team members; each provider counts its own
 * module's pending requests. Modules that have not registered a provider yet
 * contribute zero counts, so the summary shape is stable from day one and
 * grows as modules land (FR-027 extensibility).
 *
 * Provider contract:
 *   {
 *     module: "leave" | "overtime" | "trip" | "attendance",
 *     countPendingForUserIds(userIds: string[]) -> Promise<number>
 *   }
 */

const { ValidationError } = require("../domain/errors");

const PENDING_MODULES = Object.freeze([
  "attendance",
  "leave",
  "overtime",
  "trip",
  // FR-007: Permission (Ijin) module.
  "permission",
  // TODO.md: Sickness (Sakit) module.
  "sakit",
]);

class PendingSummaryService {
  constructor() {
    /** @type {Map<string, { module: string, countPendingForUserIds: (userIds: string[]) => Promise<number> }>} */
    this.providers = new Map();
  }

  /**
   * Registers a pending-count provider for a module (idempotent per module).
   *
   * @param {{ module: string, countPendingForUserIds: (userIds: string[]) => Promise<number> }} provider
   */
  registerProvider(provider) {
    if (!provider || !PENDING_MODULES.includes(provider.module)) {
      throw new ValidationError(
        `Unknown pending module "${provider?.module}".`,
        { field: "module" }
      );
    }
    if (typeof provider.countPendingForUserIds !== "function") {
      throw new ValidationError(
        "Pending provider must expose countPendingForUserIds().",
        { field: "provider" }
      );
    }
    this.providers.set(provider.module, provider);
  }

  /**
   * Computes pending-request counts for a set of users.
   *
   * @param {string[]} userIds
   * @returns {Promise<Record<string, number>>} counts keyed by module
   */
  async getPendingSummary(userIds) {
    const uniqueIds = [...new Set(userIds ?? [])];
    const summary = Object.fromEntries(PENDING_MODULES.map((m) => [m, 0]));

    for (const module of PENDING_MODULES) {
      const provider = this.providers.get(module);
      if (!provider || uniqueIds.length === 0) continue;
      const count = await provider.countPendingForUserIds(uniqueIds);
      summary[module] = Number.isFinite(count) ? count : 0;
    }

    return summary;
  }
}

module.exports = { PendingSummaryService, PENDING_MODULES };
