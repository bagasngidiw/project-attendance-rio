/**
 * EnterpriseService (FR-039) — enterprise / tenant configuration readiness.
 *
 * Single-tenant today: configuration lives in the shared `enterprise` platform
 * setting and writes are audited as SETTINGS.CHANGED.
 *
 * TENANT-ISOLATION SEAM: a future multi-tenant build keys every collection by
 * tenantId and scopes this configuration block per tenant. No multi-tenant
 * behavior is implemented here — this service is the configuration surface a
 * tenant-aware deployment would scope.
 */

const DEFAULT_ENTERPRISE_CONFIG = Object.freeze({
  brand: { companyName: "", logoUrl: "" },
  timezone: "UTC",
  defaults: {},
});

class EnterpriseService {
  /**
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ platformSettingRepository, auditService }) {
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
  }

  /** Returns the stored enterprise config normalized over the default skeleton. */
  async getEnterpriseConfig() {
    const stored = await this.platformSettingRepository.get("enterprise");
    return normalizeEnterpriseConfig(stored);
  }

  /**
   * Persists the enterprise config and records SETTINGS.CHANGED. The
   * `platform:settings` permission guards this at the route layer.
   *
   * @param {object} config
   * @param {object} actor { actorId, actorRoleKeys, ip, userAgent, correlationId }
   */
  async setEnterpriseConfig(config, actor = {}) {
    const normalized = normalizeEnterpriseConfig(config);
    const oldValue = await this.platformSettingRepository.get("enterprise");
    await this.platformSettingRepository.set("enterprise", normalized, actor.actorId ?? null);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: "enterprise", summary: "enterprise" },
      outcome: "SUCCESS",
      metadata: { setting: "enterprise", oldValue: oldValue ?? null, newValue: normalized },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { key: "enterprise", value: normalized };
  }
}

/** Merges raw input over the documented default skeleton. */
function normalizeEnterpriseConfig(raw = {}) {
  if (raw === null || raw === undefined) raw = {};
  const source = typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const brand = source.brand && typeof source.brand === "object" ? source.brand : {};
  return {
    brand: {
      companyName: typeof brand.companyName === "string" ? brand.companyName : "",
      logoUrl: typeof brand.logoUrl === "string" ? brand.logoUrl : "",
    },
    timezone: typeof source.timezone === "string" && source.timezone ? source.timezone : "UTC",
    defaults:
      source.defaults &&
      typeof source.defaults === "object" &&
      !Array.isArray(source.defaults)
        ? source.defaults
        : {},
  };
}

module.exports = { EnterpriseService, DEFAULT_ENTERPRISE_CONFIG };
