/**
 * Approval routes (FR-007 / FR-008 / FR-063). Unified list/drill-down/decide/
 * history are gated by any approve permission; decisions require any approve
 * permission (the service re-checks the request-type-specific key + assignment).
 * Escalation is open to the requester OR any approve holder. Cutoff-rule
 * administration requires platform:settings.
 */

const { Router } = require("express");
const {
  decideDto,
  escalateDto,
  approvalQuerySchema,
  cutoffRuleDto,
} = require("../dto/approval.dto");
const { validate } = require("./auth.routes");

const REVIEW_OR_APPROVE_KEYS = [
  "leave:review",
  "leave:approve",
  "overtime:review",
  "overtime:approve",
  "trip:review",
  "trip:approve",
  "permission:approve",
  "sakit:approve",
];

const APPROVE_KEYS = [
  "leave:approve",
  "overtime:approve",
  "trip:approve",
  "permission:approve",
  "sakit:approve",
];

function createApprovalRoutes({ approvalController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  // Unified single-approver surface (FR-063).
  router.get(
    "/",
    authorize(...APPROVE_KEYS),
    approvalController.unified
  );
  router.get(
    "/inbox",
    authorize(...REVIEW_OR_APPROVE_KEYS),
    approvalController.inbox
  );
  router.get(
    "/history",
    authorize(...APPROVE_KEYS),
    approvalController.history
  );
  router.get(
    "/blocked-reason/:id",
    authorize(...APPROVE_KEYS),
    approvalController.blockedReason
  );
  router.get(
    "/:id",
    authorize(...APPROVE_KEYS),
    approvalController.drillDown
  );
  router.post(
    "/:id/decide",
    authorize(...APPROVE_KEYS),
    validate(decideDto),
    approvalController.decide
  );
  router.post(
    "/:id/escalate",
    // Escalation is open to the requester OR any approve holder; the service
    // enforces that boundary (requester-or-approve + PENDING-only + rate limit).
    validate(escalateDto),
    approvalController.escalate
  );

  return router;
}

/** Cutoff-rule administration routes (FR-063 U.6). */
function createCutoffAdminRoutes({ cutoffRuleService, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);
  router.use(authorize("platform:settings"));

  router.get("/cutoff-rules", async (req, res, next) => {
    try {
      res.status(200).json({ data: await cutoffRuleService.listRules() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/cutoff-rules", validate(cutoffRuleDto), async (req, res, next) => {
    try {
      const data = await cutoffRuleService.upsertRule(req.body, {
        actorId: req.auth.userId,
        actorRoleKeys: req.auth.roles,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId,
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/cutoff-rules/:requestType", async (req, res, next) => {
    try {
      const data = await cutoffRuleService.deleteRule(req.params.requestType, {
        actorId: req.auth.userId,
        actorRoleKeys: req.auth.roles,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createApprovalRoutes, createCutoffAdminRoutes };
