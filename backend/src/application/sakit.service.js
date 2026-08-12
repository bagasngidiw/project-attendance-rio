/**
 * SakitService (TODO.md §3) — the Sickness module. A distinct business module
 * from Leave/Cuti: the requester submits a sickness request (sickness type,
 * date range, reason, optional attachment via the shared files feature) with
 * an approval target (Role or User). Uses the shared approval engine.
 */

const { validateSakitPayload } = require("../domain/request");
const { ValidationError } = require("../domain/errors");

class SakitService {
  /**
   * @param {object} deps
   * @param {import('./request.service').RequestService} deps.requestService
   * @param {import('./pending-summary.service').PendingSummaryService} deps.pendingSummaryService
   * @param {import('./approval-engine.service').ApprovalEngineService} [deps.approvalEngine]
   * @param {import('./sickness-type.service').SicknessTypeService} [deps.sicknessTypeService]
   */
  constructor({ requestService, pendingSummaryService, approvalEngine = null, sicknessTypeService = null }) {
    this.requestService = requestService;
    this.approvalEngine = approvalEngine;
    this.sicknessTypeService = sicknessTypeService;
    pendingSummaryService.registerProvider({
      module: "sakit",
      countPendingForUserIds: (userIds) =>
        this.requestService.countPendingForUserIds(userIds, "SAKIT"),
    });
  }

  /**
   * Submits a sickness request. The sickness type must be a registered ACTIVE
   * type when a master service is wired. When an `approvalTarget` is provided
   * it is validated and the snapshot + assignment are persisted.
   *
   * @param {{ requesterId: string, input: { sicknessType: string, startDate: string, endDate?: string, reason: string, approvalTarget?: object }, actor: object }} params
   */
  async submit({ requesterId, input, actor }) {
    validateSakitPayload(input);

    if (this.sicknessTypeService && !(await this.sicknessTypeService.isActiveType(input.sicknessType))) {
      throw new ValidationError(
        "Tipe sakit tidak terdaftar atau tidak aktif.",
        { field: "sicknessType" }
      );
    }

    const approval = this.approvalEngine
      ? await this.approvalEngine.prepareSubmission({ requestType: "SAKIT", input })
      : null;

    return this.requestService.submitRequest({
      type: "SAKIT",
      requesterId,
      payload: input,
      actor,
      approval,
    });
  }
}

module.exports = { SakitService };
