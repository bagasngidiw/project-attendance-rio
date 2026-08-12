/**
 * LeaveService — leave-specific submission wrapper (FR-036). Validates the
 * leave payload (type / date range / reason), enforces that the type is a
 * registered ACTIVE leave type (FR-058), and validates the request against the
 * employee's remaining balance when the type is balance-based (FR-006).
 * Delegates to the shared request service and registers the leave
 * PendingSummary provider.
 */

const { validateLeavePayload, LEAVE_TYPES } = require("../domain/request");
const { ValidationError, ConflictError } = require("../domain/errors");

class LeaveService {
  /**
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./leave-type.service').LeaveTypeService} [deps.leaveTypeService]
   * @param {import('./approval-engine.service').ApprovalEngineService} [deps.approvalEngine] FR-002/FR-006
   * @param {import('./leave-balance.service').LeaveBalanceService} [deps.leaveBalanceService] FR-006
   */
  constructor({ requestService, pendingSummaryService, leaveTypeService = null, approvalEngine = null, leaveBalanceService = null }) {
    this.requestService = requestService;
    this.leaveTypeService = leaveTypeService;
    this.approvalEngine = approvalEngine;
    this.leaveBalanceService = leaveBalanceService;
    pendingSummaryService.registerProvider({
      module: "leave",
      countPendingForUserIds: (userIds) =>
        this.requestService.countPendingForUserIds(userIds, "LEAVE"),
    });
  }

  /**
   * Submits a leave request. The leave type must be a registered ACTIVE type
   * (FR-058); when no leave-type service is wired, the system types apply.
   * For balance-based types the requested days are validated against the
   * employee's remaining balance (FR-006, server-authoritative) — the client
   * can never bypass the quota. When an `approvalTarget` is provided (FR-006)
   * it is validated and the snapshot + assignment are persisted.
   *
   * @param {{ requesterId: string, input: { leaveType: string, startDate: string, endDate: string, reason: string, approvalTarget?: object }, actor: object }} params
   */
  async submit({ requesterId, input, actor }) {
    validateLeavePayload(input);

    const registered =
      this.leaveTypeService === null
        ? LEAVE_TYPES.includes(input.leaveType)
        : await this.leaveTypeService.isActiveType(input.leaveType);
    if (!registered) {
      throw new ValidationError(
        `Leave type "${input.leaveType}" is not an active leave type.`,
        { field: "leaveType" }
      );
    }

    if (this.leaveBalanceService) {
      const type = await this.leaveTypeService?.findById(input.leaveType);
      if (type?.isBalanceBased) {
        const year = new Date().getUTCFullYear();
        const requestedDays = await this.leaveBalanceService.computeRequestedDays(
          input.startDate,
          input.endDate
        );
        const balance = await this.leaveBalanceService.getBalanceForUser(
          requesterId,
          input.leaveType,
          year
        );
        // buildItem exposes the remaining number as `balance`.
        const remaining = Number(balance?.balance ?? 0);
        if (requestedDays !== null && requestedDays > remaining) {
          throw new ConflictError(
            `Sisa cuti tidak mencukupi. Sisa: ${remaining} hari, diminta: ${requestedDays} hari.`,
            "LEAVE_BALANCE_EXCEEDED"
          );
        }
      }
    }

    const approval = this.approvalEngine
      ? await this.approvalEngine.prepareSubmission({ requestType: "LEAVE", input })
      : null;

    return this.requestService.submitRequest({
      type: "LEAVE",
      requesterId,
      payload: input,
      actor,
      approval,
    });
  }
}

module.exports = { LeaveService };
