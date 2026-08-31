/**
 * ApprovalTargetService (FR-003/FR-011) — the SINGLE reusable service for
 * resolving eligible approval targets (roles + users) across Overtime,
 * Business Trip, Leave and Permission. Module controllers orchestrate; this
 * service holds the business rules. Delegates to the configuration service
 * (FR-001) so there is exactly one implementation.
 */

const { ValidationError } = require("../domain/errors");

/** Maps the API `type` query param to the internal request type. */
const TYPE_ALIASES = Object.freeze({
  overtime: "OVERTIME",
  business_trip: "TRIP",
  leave: "LEAVE",
  permission: "PERMISSION",
  sakit: "SAKIT",
  OVERTIME: "OVERTIME",
  TRIP: "TRIP",
  LEAVE: "LEAVE",
  PERMISSION: "PERMISSION",
  SAKIT: "SAKIT",
});

class ApprovalTargetService {
  /**
   * @param {object} deps
   * @param {import('./approval-configuration.service').ApprovalConfigurationService} deps.approvalConfigurationService
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   */
  constructor({ approvalConfigurationService, userRepository }) {
    this.approvalConfigurationService = approvalConfigurationService;
    this.userRepository = userRepository;
  }

  /**
   * Resolves the eligible roles + users for a request type.
   *
   * FR-004 (contract scoping): when `requesterId` is provided, the eligible
   * USER list is narrowed to the requester's contract (same contract OR
   * contract-less approvers). Contract-less requesters see all eligible users.
   *
   * @param {string} typeParam API type alias (overtime | business_trip | leave | permission)
   * @param {string} [roleId] narrow users to one role
   * @param {string} [requesterId] scope users to the requester's contract
   */
  async getEligibleTargets(typeParam, roleId = null, requesterId = null) {
    const requestType = TYPE_ALIASES[typeParam];
    if (!requestType) {
      throw new ValidationError(
        "type must be one of overtime, business_trip, leave, permission, sakit.",
        { field: "type" }
      );
    }
    let contractTypeId = null;
    if (requesterId) {
      const requester = await this.userRepository.findById(requesterId);
      contractTypeId = requester?.contractTypeId
        ? String(requester.contractTypeId)
        : null;
    }
    const [roles, users] = await Promise.all([
      this.approvalConfigurationService.getEligibleRoles(requestType),
      this.approvalConfigurationService.getEligibleUsers(requestType, roleId, { contractTypeId }),
    ]);
    return { roles, users };
  }

  /** Maps an internal request type back to the canonical API alias. */
  toApiType(requestType) {
    return requestType === "TRIP" ? "business_trip" : requestType.toLowerCase();
  }
}

module.exports = { ApprovalTargetService, TYPE_ALIASES };
