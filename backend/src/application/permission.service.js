/**
 * PermissionService (FR-007) — the Permission (Ijin) module. Validates the
 * permission payload (single date or date range + reason), resolves the
 * approval target via the shared engine (FR-002) when provided, and delegates
 * to the shared request service. Registers the permission PendingSummary
 * provider.
 */

const { validatePermissionPayload } = require("../domain/request");

class PermissionService {
  /**
   * @param {object} deps
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./approval-engine.service').ApprovalEngineService} [deps.approvalEngine] FR-002/FR-007
   */
  constructor({ requestService, pendingSummaryService, approvalEngine = null }) {
    this.requestService = requestService;
    this.approvalEngine = approvalEngine;
    pendingSummaryService.registerProvider({
      module: "permission",
      countPendingForUserIds: (userIds) =>
        this.requestService.countPendingForUserIds(userIds, "PERMISSION"),
    });
  }

  /**
   * Submits a permission (Ijin) request. When an `approvalTarget` is provided
   * it is validated and the snapshot + assignment are persisted.
   *
   * @param {{ requesterId: string, input: { date?: string, startDate?: string, endDate?: string, reason: string, approvalTarget?: object }, actor: object }} params
   */
  async submit({ requesterId, input, actor }) {
    validatePermissionPayload(input);
    const approval = this.approvalEngine
      ? await this.approvalEngine.prepareSubmission({ requestType: "PERMISSION", input })
      : null;
    return this.requestService.submitRequest({
      type: "PERMISSION",
      requesterId,
      payload: input,
      actor,
      approval,
    });
  }
}

module.exports = { PermissionService };
