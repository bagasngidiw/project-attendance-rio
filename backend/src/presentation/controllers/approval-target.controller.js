/**
 * ApprovalTargetController (FR-003) — eligible roles + users for a request
 * type. The requester form only ever shows backend-provided choices.
 */

class ApprovalTargetController {
  constructor({ approvalTargetService }) {
    this.approvalTargetService = approvalTargetService;
  }

  /** GET /approval-targets?type=overtime[&roleId=] */
  list = async (req, res, next) => {
    try {
      // FR-004: pass the authenticated requester id so eligible users are
      // scoped to the requester's contract (same contract OR contract-less).
      const data = await this.approvalTargetService.getEligibleTargets(
        req.query.type,
        req.query.roleId ?? null,
        req.auth.userId
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { ApprovalTargetController };
