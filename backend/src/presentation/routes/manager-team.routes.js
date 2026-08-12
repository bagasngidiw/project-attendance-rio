/**
 * Manager team routes (FR-006 §5.1).
 *
 * - `team:view_team` gates team roster access.
 * - `team:view_pending` gates the pending-request summary surface.
 * Both are required for the overview; roster-only calls can use the
 * single-member endpoint.
 */

const { Router } = require("express");

function createManagerTeamRoutes({ managerTeamController, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/team",
    authorize("team:view_team"),
    authorize("team:view_pending"),
    managerTeamController.teamOverview
  );

  router.get(
    "/team/:memberId",
    authorize("team:view_team"),
    managerTeamController.teamMember
  );

  return router;
}

module.exports = { createManagerTeamRoutes };
