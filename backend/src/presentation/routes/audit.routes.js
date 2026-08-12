/**
 * Audit routes (FR-012 / FR-013, design §5.1). Every endpoint requires
 * `audit:view`; the service applies actor scoping (SUPER_ADMIN all, others
 * own-actions only).
 */

const { Router } = require("express");

function createAuditRoutes({ auditController, authenticate, authorize }) {
  const router = Router();

  // Path-scoped so unrelated /api/v1/* URLs still fall through to the
  // not-found handler instead of being swallowed by this router's auth guard.
  const guard = [authenticate, authorize("audit:view")];

  router.get("/audit/events", ...guard, auditController.listEvents);
  router.get("/audit/events/:id", ...guard, auditController.getEvent);
  router.get("/audit/verify", ...guard, auditController.verifyChain);
  router.get("/audit/export", ...guard, auditController.exportEvents);
  router.get("/activity/records", ...guard, auditController.listActivity);

  return router;
}

module.exports = { createAuditRoutes };
