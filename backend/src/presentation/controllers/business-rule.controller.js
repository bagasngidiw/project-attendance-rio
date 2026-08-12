/**
 * BusinessRuleController — configurable overtime / business-trip rules
 * (FR-046), guarded by `platform:settings` (SUPER_ADMIN only in the seed).
 *
 * Reads go through BusinessRuleService (normalized, defaults when unset);
 * writes validate via the domain, persist through the shared
 * PlatformSettingRepository, and are recorded as SETTINGS.CHANGED with the
 * old and new value.
 */

const {
  normalizeOvertimeRules,
  normalizeTripRules,
  validateOvertimeRules,
  validateTripRules,
} = require("../../domain/business-rules");

const RULES_KEY_BY_TYPE = Object.freeze({
  overtime: "overtimeRules",
  trip: "tripRules",
});

class BusinessRuleController {
  /**
   * @param {object} deps
   * @param {import('../../application/business-rule.service').BusinessRuleService} deps.businessRuleService
   * @param {import('../../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('../../application/audit.service').AuditService} deps.auditService
   */
  constructor({ businessRuleService, platformSettingRepository, auditService }) {
    this.businessRuleService = businessRuleService;
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
  }

  /** GET /admin/business-rules/:type — effective rules for a type. */
  getRules = async (req, res, next) => {
    try {
      const data = await this.businessRuleService.getRulesForType(
        req.params.type
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /admin/business-rules/:type — replace the rules for a type (audited). */
  updateRules = async (req, res, next) => {
    try {
      const actor = this.actor(req);
      const type = req.params.type;
      this.businessRuleService.assertValidType(type);

      const normalize = type === "trip" ? normalizeTripRules : normalizeOvertimeRules;
      const validate = type === "trip" ? validateTripRules : validateOvertimeRules;
      const nextRules = validate(normalize(req.body));

      const settingKey = RULES_KEY_BY_TYPE[type];
      const oldValue = await this.platformSettingRepository.get(settingKey);
      await this.platformSettingRepository.set(
        settingKey,
        nextRules,
        actor.actorId
      );

      await this.auditService.record({
        action: "SETTINGS.CHANGED",
        actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
        subject: { type: "SETTING", id: settingKey, summary: settingKey },
        outcome: "SUCCESS",
        metadata: {
          setting: settingKey,
          oldValue: oldValue ?? null,
          newValue: nextRules,
        },
        correlationId: actor.correlationId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });

      res.status(200).json({ data: nextRules });
    } catch (err) {
      next(err);
    }
  };

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { BusinessRuleController };
