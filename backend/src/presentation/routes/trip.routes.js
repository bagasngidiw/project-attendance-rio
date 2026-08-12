/**
 * Business trip routes (FR-054) — submission guarded by `trip:submit`.
 */

const { Router } = require("express");
const { tripSubmitDto } = require("../dto/trip.dto");
const { validate } = require("./auth.routes");

function createTripRoutes({ tripController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/requests",
    authenticate,
    authorize("trip:submit"),
    validate(tripSubmitDto),
    tripController.submit
  );

  return router;
}

module.exports = { createTripRoutes };
