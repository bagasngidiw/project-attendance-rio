/**
 * Report routes (FR-018 / FR-019). Preview requires `reporting:view`; export
 * re-checks `export_excel` in the service. PDF export was removed (FR-006).
 */

const { Router } = require("express");

function createReportRoutes({ reportController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/types", authorize("reporting:view"), reportController.listTypes);
  router.get("/:type", authorize("reporting:view"), reportController.preview);
  router.get(
    "/:type/export",
    authorize("reporting:view"),
    reportController.exportReport
  );
  // FR-063 U.9: all-modules Excel export (the service re-checks export_excel).
  router.post("/export", authorize("reporting:view"), reportController.exportAll);

  return router;
}

module.exports = { createReportRoutes };
