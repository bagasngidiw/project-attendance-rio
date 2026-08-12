/**
 * RBAC admin console routes (FR-011 §5.1). Read endpoints require
 * `rbac:view_*`; write endpoints require `rbac:manage_*`.
 */

const { Router } = require("express");
const {
  createRoleDto,
  updateRoleDto,
  setPermissionsDto,
  toggleRoleStatusDto,
  validateRoleDto,
} = require("../dto/rbac-admin.dto");
const { validate } = require("./auth.routes");

function createRbacAdminRoutes({ rbacAdminController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  // FR-064: console metadata (read).
  router.get(
    "/meta",
    authorize("rbac:view_roles"),
    rbacAdminController.getMeta
  );

  // Matrix (read) — requires BOTH view permissions (chained OR-guards).
  router.get(
    "/matrix",
    authorize("rbac:view_roles"),
    authorize("rbac:view_permissions"),
    rbacAdminController.getMatrix
  );

  // Role lifecycle (write).
  router.post(
    "/roles",
    authorize("rbac:manage_roles"),
    validate(createRoleDto),
    rbacAdminController.createRole
  );
  router.get(
    "/roles/:id",
    authorize("rbac:view_roles"),
    rbacAdminController.getRole
  );
  router.put(
    "/roles/:id",
    authorize("rbac:manage_roles"),
    validate(updateRoleDto),
    rbacAdminController.updateRole
  );
  // FR-064: validate a prospective role before save (write capability).
  router.post(
    "/roles/validate",
    authorize("rbac:manage_roles"),
    validate(validateRoleDto),
    rbacAdminController.validateRole
  );
  // FR-064: effective-access preview (read).
  router.get(
    "/roles/:id/preview",
    authorize("rbac:view_permissions"),
    rbacAdminController.previewRole
  );
  router.patch(
    "/roles/:id/permissions",
    authorize("rbac:manage_permissions"),
    validate(setPermissionsDto),
    rbacAdminController.setPermissions
  );
  router.post(
    "/roles/:id/disable",
    authorize("rbac:manage_roles"),
    validate(toggleRoleStatusDto),
    rbacAdminController.disableRole
  );
  router.post(
    "/roles/:id/enable",
    authorize("rbac:manage_roles"),
    validate(toggleRoleStatusDto),
    rbacAdminController.enableRole
  );
  // FR-064: copy an existing role into an editable draft (read capability).
  router.get(
    "/roles/copy/:sourceId",
    authorize("rbac:view_roles"),
    rbacAdminController.copyRole
  );

  // Effective-permission viewer (read).
  router.get(
    "/users/:id/effective-permissions",
    authorize("rbac:view_permissions"),
    rbacAdminController.getEffectivePermissions
  );

  return router;
}

module.exports = { createRbacAdminRoutes };
