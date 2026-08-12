/**
 * Navigation routes (FR-003, design §5.1). Authenticated; no permission guard
 * required because the response is already filtered to the caller's own
 * effective permissions (server never returns what the user cannot see).
 */

const { Router } = require("express");
const { z } = require("zod");
const { ValidationError } = require("../../domain/errors");

const accessCheckDto = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100),
});

function validateAccessCheck(req, res, next) {
  const result = accessCheckDto.safeParse(req.body);
  if (!result.success) {
    next(
      new ValidationError("Request validation failed.", {
        issues: result.error.issues,
      })
    );
    return;
  }
  req.body = result.data;
  next();
}

function createNavigationRoutes({ navigationController, authenticate }) {
  const router = Router();

  // Path-scoped so an unrelated /api/v1/* URL still falls through to the
  // not-found handler instead of being swallowed by this router's 401.
  router.get("/navigation", authenticate, navigationController.navigation);
  router.post(
    "/access/check",
    authenticate,
    validateAccessCheck,
    navigationController.checkAccess
  );

  return router;
}

module.exports = { createNavigationRoutes };
