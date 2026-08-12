/**
 * BusinessRuleService (FR-046) — reads and enforces the configurable
 * overtime / business-trip rules stored in the platform settings
 * (`overtimeRules` / `tripRules`). Unset rules fall back to the domain
 * defaults; enforcement runs the pure domain checks against a submission
 * payload before a request is persisted.
 */

const {
  BUSINESS_RULE_TYPES,
  normalizeOvertimeRules,
  normalizeTripRules,
  enforceOvertimeRules,
  enforceTripRules,
} = require("../domain/business-rules");
const { ValidationError } = require("../domain/errors");

const RULES_KEY_BY_TYPE = Object.freeze({
  overtime: "overtimeRules",
  trip: "tripRules",
});

const NORMALIZE_BY_TYPE = Object.freeze({
  overtime: normalizeOvertimeRules,
  trip: normalizeTripRules,
});

const ENFORCE_BY_TYPE = Object.freeze({
  overtime: enforceOvertimeRules,
  trip: enforceTripRules,
});

class BusinessRuleService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   */
  constructor({ platformSettingRepository }) {
    this.platformSettingRepository = platformSettingRepository;
  }

  /** Throws ValidationError for an unsupported rule type. */
  assertValidType(type) {
    if (!BUSINESS_RULE_TYPES.includes(type)) {
      throw new ValidationError(
        `Unsupported rule type "${type}". Allowed: ${BUSINESS_RULE_TYPES.join(", ")}.`,
        { field: "type" }
      );
    }
  }

  /**
   * Returns the effective rules for a type: stored value normalized, or the
   * defaults when unset.
   *
   * @param {string} type "overtime" | "trip"
   */
  async getRulesForType(type) {
    this.assertValidType(type);
    const stored = await this.platformSettingRepository.get(
      RULES_KEY_BY_TYPE[type]
    );
    return NORMALIZE_BY_TYPE[type](stored ?? {});
  }

  /**
   * Loads the rules for `type` and enforces them against a submission payload.
   * Throws ValidationError on any violation.
   *
   * @param {string} type "overtime" | "trip"
   * @param {object} payload the request payload (date/startTime/endTime or startDate/endDate)
   * @param {object} [context] optional counts for weekly/monthly caps
   */
  async enforceForType(type, payload, context = {}) {
    this.assertValidType(type);
    const rules = await this.getRulesForType(type);
    return ENFORCE_BY_TYPE[type](payload, rules, context);
  }
}

module.exports = { BusinessRuleService };
