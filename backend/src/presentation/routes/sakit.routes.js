/**
 * Sakit routes (TODO.md §3) — submission guarded by `sakit:submit`.
 * Approval actions reuse the shared claim/approve/reject surface.
 */

const { Router } = require("express");
const { sakitSubmitDto } = require("../dto/sakit.dto");
const { validate } = require("./auth.routes");

function createSakitRoutes({ sakitController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/requests",
    authenticate,
    authorize("sakit:submit"),
    validate(sakitSubmitDto),
    sakitController.submit
  );

  return router;
}

/** Sickness-type routes: public active list + suggest (auth) + admin manage. */
function createSicknessTypeRoutes({ sicknessTypeController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);

  // Active types for the submission form + "Tambahkan sendiri" suggestion.
  router.get("/", sicknessTypeController.listActive);
  router.post(
    "/suggest",
    authorize("sakit:submit"),
    validate(require("../dto/sakit.dto").suggestSicknessTypeDto),
    sicknessTypeController.suggest
  );

  return router;
}

function createSicknessTypeAdminRoutes({ sicknessTypeController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);
  router.use(authorize("platform:settings"));

  const { createSicknessTypeDto, updateSicknessTypeDto } = require("../dto/sakit.dto");
  router.get("/", sicknessTypeController.listAdmin);
  router.post("/", validate(createSicknessTypeDto), sicknessTypeController.create);
  router.put("/:id", validate(updateSicknessTypeDto), sicknessTypeController.update);
  router.post("/:id/activate", sicknessTypeController.activate);
  router.post("/:id/deactivate", sicknessTypeController.deactivate);

  return router;
}

module.exports = { createSakitRoutes, createSicknessTypeRoutes, createSicknessTypeAdminRoutes };
