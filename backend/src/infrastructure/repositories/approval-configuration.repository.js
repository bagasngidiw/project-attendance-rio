/**
 * ApprovalConfigurationRepository (FR-001) — persistence for the per-request
 * type approval configuration, with optimistic-lock guarding on updates.
 */

const { ApprovalConfigurationModel } = require("../models/approval-configuration.model");
const { ConflictError } = require("../../domain/errors");

class ApprovalConfigurationRepository {
  /** @param {string} requestType */
  async getByType(requestType) {
    return ApprovalConfigurationModel.findOne({ requestType }).lean();
  }

  async listAll() {
    return ApprovalConfigurationModel.find().sort({ requestType: 1, _id: 1 }).lean();
  }

  /**
   * Creates or updates a configuration (optimistic lock via `version`).
   *
   * @param {{ requestType: string, roles: Array, selfApproval: boolean, expectedVersion?: number }} input
   * @param {string|null} updatedBy
   */
  async upsert(input, updatedBy = null) {
    const existing = await ApprovalConfigurationModel.findOne({
      requestType: input.requestType,
    });
    if (existing) {
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new ConflictError(
          "The approval configuration was modified by another administrator. Reload and retry.",
          "OPTIMISTIC_LOCK_CONFLICT"
        );
      }
      existing.roles = input.roles;
      existing.selfApproval = input.selfApproval === true;
      existing.updatedBy = updatedBy ?? null;
      existing.version += 1;
      await existing.save();
      return existing.toObject();
    }
    return ApprovalConfigurationModel.create({
      requestType: input.requestType,
      roles: input.roles,
      selfApproval: input.selfApproval === true,
      updatedBy: updatedBy ?? null,
      version: 1,
    });
  }
}

module.exports = { ApprovalConfigurationRepository };
