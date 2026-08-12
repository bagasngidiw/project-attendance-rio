/**
 * Approval-target routes (FR-003). Authenticated; gated by the submit
 * permission of the module so requesters can pre-load eligible choices.
 */

const { Router } = require("express");

function createApprovalTargetRoutes({ approvalTargetController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/",
    authorize("leave:submit", "overtime:submit", "trip:submit", "permission:submit", "sakit:submit"),
    approvalTargetController.list
  );

  return router;
}

module.exports = { createApprovalTargetRoutes };
