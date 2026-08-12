/**
 * RBAC routes (design §5.1). Every endpoint is authenticated and guarded by
 * the appropriate permission. The permission console (CRUD) is deferred to
 * FR-011; this file exposes the read + assignment surface only.
 */

const { Router } = require("express");
const { assignRolesDto } = require("../dto/rbac.dto");
const { validate } = require("./auth.routes");

function createRbacRoutes({ rbacController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/roles",
    authorize("rbac:view_roles"),
    rbacController.listRoles
  );
  router.get(
    "/roles/:id",
    authorize("rbac:view_roles"),
    rbacController.getRole
  );
  router.get(
    "/permissions",
    authorize("rbac:view_permissions"),
    rbacController.listPermissions
  );
  router.get(
    "/users/:id/effective-permissions",
    authorize("rbac:view_permissions"),
    rbacController.getUserEffectivePermissions
  );
  router.put(
    "/users/:id/roles",
    authorize("users:assign_roles"),
    validate(assignRolesDto),
    rbacController.assignRoles
  );

  return router;
}

module.exports = { createRbacRoutes };
