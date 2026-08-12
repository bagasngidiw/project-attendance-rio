/**
 * TripService — business trip-specific submission wrapper (FR-054). Validates
 * the trip payload (destination / date range / purpose), optionally enforces
 * the configurable business rules (FR-046), and delegates to the shared
 * request service. Registers the trip PendingSummary provider.
 */

const { validateTripPayload } = require("../domain/request");

class TripService {
  /**
   * @param {object} deps
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./business-rule.service').BusinessRuleService} [deps.businessRuleService] optional business-rule enforcement (FR-046)
   * @param {import('./approval-engine.service').ApprovalEngineService} [deps.approvalEngine] FR-002/FR-005
   */
  constructor({ requestService, pendingSummaryService, businessRuleService, approvalEngine }) {
    this.requestService = requestService;
    this.businessRuleService = businessRuleService ?? null;
    this.approvalEngine = approvalEngine ?? null;
    pendingSummaryService.registerProvider({
      module: "trip",
      countPendingForUserIds: (userIds) =>
        this.requestService.countPendingForUserIds(userIds, "TRIP"),
    });
  }

  /**
   * Submits a business trip request. When a businessRuleService is wired, the
   * configured trip rules are enforced before the request is persisted.
   * When an `approvalTarget` is provided (FR-005) it is validated and the
   * snapshot + assignment are persisted.
   *
   * @param {{ requesterId: string, input: { destination: string, startDate: string, endDate: string, purpose: string, approvalTarget?: object }, actor: object }} params
   */
  async submit({ requesterId, input, actor }) {
    validateTripPayload(input);
    if (this.businessRuleService) {
      await this.businessRuleService.enforceForType("trip", input);
    }
    const approval = this.approvalEngine
      ? await this.approvalEngine.prepareSubmission({ requestType: "TRIP", input })
      : null;
    return this.requestService.submitRequest({
      type: "TRIP",
      requesterId,
      payload: input,
      actor,
      approval,
    });
  }
}

module.exports = { TripService };
