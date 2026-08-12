/**
 * Delegation routes (FR-009). Listing is owner-scoped (auth); create and
 * revoke additionally require `delegation:manage`. Revocation is further
 * restricted to the delegator in the service layer.
 */

const { Router } = require("express");
const { delegationCreateDto } = require("../dto/delegation.dto");
const { validate } = require("./auth.routes");

function createDelegationRoutes({ delegationController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/", delegationController.list);
  router.post(
    "/",
    authorize("delegation:manage"),
    validate(delegationCreateDto),
    delegationController.create
  );
  router.post(
    "/:id/revoke",
    authorize("delegation:manage"),
    delegationController.revoke
  );

  return router;
}

module.exports = { createDelegationRoutes };
