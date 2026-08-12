/**
 * Leave balance routes (FR-022) — self visibility, HR cross-user visibility,
 * and HR adjustments.
 */

const { Router } = require("express");
const { adjustBalanceDto } = require("../dto/leave-balance.dto");
const { validate } = require("./auth.routes");

function createLeaveBalanceRoutes({ leaveBalanceController, authenticate, authorize }) {
  const router = Router();

  router.get(
    "/balances",
    authenticate,
    authorize("leave:view_balances"),
    leaveBalanceController.getMyBalances
  );
  router.get(
    "/users/:userId/balances",
    authenticate,
    authorize("leave:view_all"),
    leaveBalanceController.getUserBalances
  );
  router.post(
    "/users/:userId/balances/adjust",
    authenticate,
    authorize("leave:manage_balances"),
    validate(adjustBalanceDto),
    leaveBalanceController.adjust
  );

  return router;
}

module.exports = { createLeaveBalanceRoutes };
