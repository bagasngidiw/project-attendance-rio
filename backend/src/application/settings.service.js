/**
 * SettingsService (FR-032) — generic auditable platform settings surface.
 *
 * A schema registry defines the allowed setting keys and value types; every
 * write is validated, persisted via the shared PlatformSettingRepository, and
 * recorded as SETTINGS.CHANGED with the old and new value.
 */

const { ValidationError } = require("../domain/errors");

/** Allowed settings + their value validation rules (FR-032 catalog). */
const SETTINGS_SCHEMA = Object.freeze({
  sessionInactivityMs: { type: "number", min: 60000, max: 7 * 24 * 60 * 60 * 1000 },
  maxFailedAttempts: { type: "number", min: 1, max: 20 },
  lockoutMs: { type: "number", min: 60000, max: 24 * 60 * 60 * 1000 },
  rejectionReasonRequired: { type: "boolean" },
  companyTimezoneOffsetMs: { type: "number", min: -43200000, max: 50400000 },
  timezone: { type: "string", maxLength: 64 },
  moduleEnablement: { type: "object" },
  notificationDefaults: { type: "object" },
  attendanceExceptionThresholds: { type: "object" },
  overtimeRules: { type: "object" },
  tripRules: { type: "object" },
  // FR-009: approval delegation + escalation configuration.
  escalationConfig: { type: "object" },
  // FR-017: file upload governance (allowed types + max size).
  fileUpload: { type: "object" },
  // FR-040: data retention policy per category.
  retentionPolicy: { type: "object" },
  // FR-039: enterprise/branding configuration block (read-only for now).
  enterprise: { type: "object" },
  // FR-051: MFA requirements for elevated roles.
  mfaRequirements: { type: "object" },
  // FR-045: self-service recovery settings.
  recoverySettings: { type: "object" },
});

class SettingsService {
  /**
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ platformSettingRepository, auditService }) {
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
  }

  /** All platform settings (stored values; unset keys return null). */
  async getSettings() {
    const result = {};
    for (const key of Object.keys(SETTINGS_SCHEMA)) {
      result[key] = await this.platformSettingRepository.get(key);
    }
    return result;
  }

  /**
   * Updates a single setting: validates the key + value, persists, audits.
   *
   * @param {string} key
   * @param {unknown} value
   * @param {object} actor
   */
  async updateSetting(key, value, actor = {}) {
    const rule = SETTINGS_SCHEMA[key];
    if (!rule) {
      throw new ValidationError(`Unknown platform setting "${key}".`, {
        field: "key",
      });
    }
    this.validateValue(key, value, rule);

    const oldValue = await this.platformSettingRepository.get(key);
    await this.platformSettingRepository.set(key, value, actor.actorId ?? null);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: key, summary: key },
      outcome: "SUCCESS",
      metadata: { setting: key, oldValue: oldValue ?? null, newValue: value },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { key, value };
  }

  validateValue(key, value, rule) {
    if (rule.type === "number" && typeof value !== "number") {
      throw new ValidationError(`${key} must be a number.`, { field: key });
    }
    if (rule.type === "boolean" && typeof value !== "boolean") {
      throw new ValidationError(`${key} must be a boolean.`, { field: key });
    }
    if (rule.type === "string" && (typeof value !== "string" || value.length > rule.maxLength)) {
      throw new ValidationError(`${key} must be a short string.`, { field: key });
    }
    if (rule.type === "object" && (typeof value !== "object" || value === null)) {
      throw new ValidationError(`${key} must be an object.`, { field: key });
    }
    if (rule.type === "number" && typeof value === "number") {
      if (value < rule.min || value > rule.max) {
        throw new ValidationError(`${key} is out of range.`, { field: key });
      }
    }
  }
}

module.exports = { SettingsService, SETTINGS_SCHEMA };
