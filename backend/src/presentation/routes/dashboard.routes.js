/**
 * Dashboard routes (FR-025 / FR-026). `/dashboard/hr` requires both
 * `dashboard:view` AND an HR-scope permission (`attendance:view_all` or
 * `reporting:view`) — chained authorize calls enforce AND semantics.
 */

const { Router } = require("express");

function createDashboardRoutes({ dashboardController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/me", authorize("dashboard:view"), dashboardController.me);
  router.get(
    "/hr",
    authorize("dashboard:view"),
    authorize("attendance:view_all", "reporting:view"),
    dashboardController.hr
  );

  return router;
}

module.exports = { createDashboardRoutes };
