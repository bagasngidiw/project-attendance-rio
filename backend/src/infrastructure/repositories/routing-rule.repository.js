/**
 * RoutingRuleRepository — persistence for FR-042 routing configuration.
 * Returns null when no rule is stored so the caller can apply the default.
 */

const { RoutingRuleModel } = require("../models/routing-rule.model");

class RoutingRuleRepository {
  /** @param {string} requestType LEAVE | OVERTIME | TRIP */
  async getByType(requestType) {
    const doc = await RoutingRuleModel.findOne({ requestType }).lean();
    return doc ?? null;
  }

  /** @returns {Promise<object[]>} all stored rules */
  async listAll() {
    return RoutingRuleModel.find().lean();
  }

  /**
   * Upserts a rule for a request type.
   *
   * @param {object} rule validated rule (requestType, levels, fallback, enabled)
   * @param {string|null} updatedBy
   */
  async upsert(rule, updatedBy = null) {
    await RoutingRuleModel.findOneAndUpdate(
      { requestType: rule.requestType },
      {
        $set: {
          levels: rule.levels,
          fallback: rule.fallback,
          enabled: rule.enabled,
          updatedBy,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return this.getByType(rule.requestType);
  }
}

module.exports = { RoutingRuleRepository };
