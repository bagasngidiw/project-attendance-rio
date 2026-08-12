/**
 * CutoffRuleRepository — persistence for FR-063 cutoff/calendar approval
 * blocks. Rules are keyed by request type (or "*" as a global fallback).
 */

const { CutoffRuleModel } = require("../models/cutoff-rule.model");

class CutoffRuleRepository {
  /**
   * @param {{ requestType: string, days?: number[], fromTime?: string, toTime?: string, timezone?: string, dependsOn?: string, enabled?: boolean }} input
   */
  async upsert(input, updatedBy = null) {
    return CutoffRuleModel.findOneAndUpdate(
      { requestType: input.requestType },
      {
        $set: {
          days: input.days ?? [],
          fromTime: input.fromTime ?? "",
          toTime: input.toTime ?? "",
          timezone: input.timezone ?? "",
          dependsOn: input.dependsOn ?? "",
          enabled: input.enabled !== false,
          updatedBy: updatedBy ?? null,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
  }

  /** @param {string} requestType */
  async getByType(requestType) {
    return CutoffRuleModel.findOne({ requestType }).lean();
  }

  async listAll() {
    return CutoffRuleModel.find().sort({ requestType: 1, _id: 1 }).lean();
  }

  /** @param {string} requestType */
  async deleteByType(requestType) {
    return CutoffRuleModel.deleteOne({ requestType });
  }
}

module.exports = { CutoffRuleRepository };
