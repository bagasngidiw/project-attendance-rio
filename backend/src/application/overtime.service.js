/**
 * OvertimeService — overtime-specific submission wrapper (FR-054). Validates
 * the overtime payload (date / time range / reason), optionally enforces the
 * configurable business rules (FR-046), and delegates to the shared request
 * service. Registers the overtime PendingSummary provider.
 */

const { validateOvertimePayload } = require("../domain/request");

class OvertimeService {
  /**
   * @param {object} deps
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./business-rule.service').BusinessRuleService} [deps.businessRuleService] optional business-rule enforcement (FR-046)
   * @param {import('./approval-engine.service').ApprovalEngineService} [deps.approvalEngine] FR-002/FR-004
   */
  constructor({ requestService, pendingSummaryService, businessRuleService, approvalEngine }) {
    this.requestService = requestService;
    this.businessRuleService = businessRuleService ?? null;
    this.approvalEngine = approvalEngine ?? null;
    pendingSummaryService.registerProvider({
      module: "overtime",
      countPendingForUserIds: (userIds) =>
        this.requestService.countPendingForUserIds(userIds, "OVERTIME"),
    });
  }

  /**
   * Submits an overtime request. When a businessRuleService is wired, the
   * configured overtime rules are enforced before the request is persisted.
   * When an `approvalTarget` is provided (FR-004) it is validated and the
   * snapshot + assignment are persisted.
   *
   * @param {{ requesterId: string, input: { date: string, startTime: string, endTime: string, reason: string, approvalTarget?: object }, actor: object }} params
   */
  async submit({ requesterId, input, actor }) {
    validateOvertimePayload(input);
    if (this.businessRuleService) {
      await this.businessRuleService.enforceForType("overtime", input);
    }
    const approval = this.approvalEngine
      ? await this.approvalEngine.prepareSubmission({ requestType: "OVERTIME", input })
      : null;
    return this.requestService.submitRequest({
      type: "OVERTIME",
      requesterId,
      payload: input,
      actor,
      approval,
    });
  }
}

module.exports = { OvertimeService };
