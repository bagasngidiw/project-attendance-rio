/**
 * Filter preset routes (FR-047) — all authenticated and owner-scoped to the
 * signed-in user (no special permission required).
 */

const { Router } = require("express");
const {
  createFilterPresetDto,
  updateFilterPresetDto,
} = require("../dto/filter-preset.dto");
const { validate } = require("./auth.routes");

function createFilterPresetRoutes({ filterPresetController, authenticate }) {
  const router = Router();

  router.use(authenticate);

  router.get("/", filterPresetController.list);
  router.post("/", validate(createFilterPresetDto), filterPresetController.create);
  router.patch("/:id", validate(updateFilterPresetDto), filterPresetController.update);
  router.delete("/:id", filterPresetController.remove);

  return router;
}

module.exports = { createFilterPresetRoutes };
