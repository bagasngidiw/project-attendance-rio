/**
 * Reporting routes (FR-043). Manager assignment requires `users:edit`;
 * reading direct reports requires `team:view_team` or `users:view`; history
 * requires `users:view`.
 */

const { Router } = require("express");
const { assignManagerDto } = require("../dto/reporting.dto");
const { validate } = require("./auth.routes");

function createReportingRoutes({ reportingController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.put(
    "/users/:id/manager",
    authorize("users:edit"),
    validate(assignManagerDto),
    reportingController.assignManager
  );
  router.get(
    "/users/:id/direct-reports",
    authorize("team:view_team", "users:view"),
    reportingController.directReports
  );
  router.get(
    "/users/:id/manager-history",
    authorize("users:view"),
    reportingController.managerHistory
  );

  return router;
}

module.exports = { createReportingRoutes };
