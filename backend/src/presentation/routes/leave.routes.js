/**
 * Leave routes (FR-036 / FR-058) — submission guarded by `leave:submit`;
 * active leave types readable by anyone who can submit or view users.
 */

const { Router } = require("express");
const { leaveSubmitDto } = require("../dto/leave.dto");
const { suggestLeaveTypeDto } = require("../dto/leave-type.dto");
const { validate } = require("./auth.routes");

function createLeaveRoutes({ leaveController, leaveTypeController, authenticate, authorize }) {
  const router = Router();

  router.get(
    "/types",
    authenticate,
    authorize("leave:submit", "users:view"),
    leaveTypeController.listActive
  );
  // TODO.md §6 "Tambahkan sendiri": requester suggests a new Cuti type (PENDING).
  router.post(
    "/types/suggest",
    authenticate,
    authorize("leave:submit"),
    validate(suggestLeaveTypeDto),
    leaveTypeController.suggest
  );
  router.post(
    "/requests",
    authenticate,
    authorize("leave:submit"),
    validate(leaveSubmitDto),
    leaveController.submit
  );
  // TODO.md FR-004/FR-007: the caller's own leave balances (self).
  router.get(
    "/balances",
    authenticate,
    authorize("leave:view_balances"),
    leaveController.listBalances
  );

  return router;
}

module.exports = { createLeaveRoutes };
