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
      const data = await this.approvalTargetService.getEligibleTargets(
        req.query.type,
        req.query.roleId ?? null
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { ApprovalTargetController };
