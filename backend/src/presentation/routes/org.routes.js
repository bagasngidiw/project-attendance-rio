/**
 * Org routes (FR-024). Reads are open to `org:manage_*` or `users:view`;
 * writes require the manage permission. `/active` picker routes precede the
 * `/:id` write routes.
 */

const { Router } = require("express");
const {
  createDepartmentDto,
  updateDepartmentDto,
  createPositionDto,
  updatePositionDto,
} = require("../dto/org.dto");
const { validate } = require("./auth.routes");

function createOrgRoutes({ orgController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  /* Departments */
  router.get(
    "/departments",
    authorize("org:manage_departments", "users:view"),
    orgController.listDepartments
  );
  router.get(
    "/departments/active",
    authorize("org:manage_departments", "users:view"),
    orgController.listActiveDepartments
  );
  router.post(
    "/departments",
    authorize("org:manage_departments"),
    validate(createDepartmentDto),
    orgController.createDepartment
  );
  router.put(
    "/departments/:id",
    authorize("org:manage_departments"),
    validate(updateDepartmentDto),
    orgController.updateDepartment
  );
  router.post(
    "/departments/:id/deactivate",
    authorize("org:manage_departments"),
    orgController.deactivateDepartment
  );
  router.post(
    "/departments/:id/activate",
    authorize("org:manage_departments"),
    orgController.activateDepartment
  );

  /* Positions */
  router.get(
    "/positions",
    authorize("org:manage_positions", "users:view"),
    orgController.listPositions
  );
  router.get(
    "/positions/active",
    authorize("org:manage_positions", "users:view"),
    orgController.listActivePositions
  );
  router.post(
    "/positions",
    authorize("org:manage_positions"),
    validate(createPositionDto),
    orgController.createPosition
  );
  router.put(
    "/positions/:id",
    authorize("org:manage_positions"),
    validate(updatePositionDto),
    orgController.updatePosition
  );
  router.post(
    "/positions/:id/deactivate",
    authorize("org:manage_positions"),
    orgController.deactivatePosition
  );
  router.post(
    "/positions/:id/activate",
    authorize("org:manage_positions"),
    orgController.activatePosition
  );

  return router;
}

module.exports = { createOrgRoutes };
