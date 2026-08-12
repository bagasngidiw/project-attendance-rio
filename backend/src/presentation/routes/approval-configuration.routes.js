/**
 * Approval configuration routes (FR-001) — Superadmin only
 * (`approval_config:manage`).
 */

const { Router } = require("express");
const { updateConfigurationDto } = require("../dto/approval-configuration.dto");
const { validate } = require("./auth.routes");

function createApprovalConfigurationRoutes({
  approvalConfigurationController,
  authenticate,
  authorize,
}) {
  const router = Router();

  router.use(authenticate);
  router.use(authorize("approval_config:manage"));

  router.get("/", approvalConfigurationController.list);
  router.get("/:requestType", approvalConfigurationController.get);
  router.put(
    "/:requestType",
    validate(updateConfigurationDto),
    approvalConfigurationController.update
  );

  return router;
}

module.exports = { createApprovalConfigurationRoutes };
