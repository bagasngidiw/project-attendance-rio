/**
 * Shared request routes (FR-016 + FR-002). All are requester-scoped; the
 * service answers 404 for anyone who does not own the request (no existence
 * leak). Cancel additionally requires any module submit permission (defense in
 * depth — the ownership check is the primary control). Claim/approve/reject
 * are the shared approval-engine surface (FR-002).
 */

const { Router } = require("express");
const {
  cancelRequestDto,
  editRequestDto,
  rejectRequestDto,
} = require("../dto/request.dto");
const { validate } = require("./auth.routes");

const VIEW_OWN_KEYS = [
  "leave:view_own",
  "overtime:view_own",
  "trip:view_own",
  "permission:view_own",
  "sakit:view_own",
];
const SUBMIT_KEYS = [
  "leave:submit",
  "overtime:submit",
  "trip:submit",
  "permission:submit",
  "sakit:submit",
];
const APPROVE_KEYS = [
  "leave:approve",
  "overtime:approve",
  "trip:approve",
  "permission:approve",
  "sakit:approve",
];
const VIEW_OR_APPROVE_KEYS = [...VIEW_OWN_KEYS, ...APPROVE_KEYS];

function createRequestRoutes({ requestController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get("/mine", requestController.mine);
  router.get("/:id", authorize(...VIEW_OWN_KEYS), requestController.getById);
  router.get(
    "/:id/history",
    authorize(...VIEW_OR_APPROVE_KEYS),
    requestController.history
  );
  router.get(
    "/:id/approval-history",
    authorize(...VIEW_OR_APPROVE_KEYS),
    requestController.approvalHistory
  );
  router.put(
    "/:id",
    authorize(...SUBMIT_KEYS),
    validate(editRequestDto),
    requestController.edit
  );
  router.post(
    "/:id/cancel",
    authorize(...SUBMIT_KEYS),
    validate(cancelRequestDto),
    requestController.cancel
  );
  // FR-002 shared approval-engine surface (guards re-checked in the service).
  router.post(
    "/:id/claim",
    authorize(...APPROVE_KEYS),
    requestController.claim
  );
  router.post(
    "/:id/approve",
    authorize(...APPROVE_KEYS),
    requestController.approve
  );
  router.post(
    "/:id/reject",
    authorize(...APPROVE_KEYS),
    validate(rejectRequestDto),
    requestController.reject
  );

  return router;
}

module.exports = { createRequestRoutes };
