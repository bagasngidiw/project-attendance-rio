const { Router } = require("express");
const { validate } = require("./auth.routes");
const {
  hierarchyQueryDto,
  createHierarchyDto,
  eligibleUserQueryDto,
  addHierarchyNodeDto,
  removeHierarchyNodeDto,
  versionDto,
} = require("../dto/hierarchy.dto");

function parseQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const { ValidationError } = require("../../domain/errors");
      next(new ValidationError("Invalid hierarchy query.", { issues: result.error.issues }));
      return;
    }
    req.filters = result.data;
    req.query = result.data;
    next();
  };
}

function createHierarchyRoutes({ hierarchyController, authenticate, authorize }) {
  const router = Router();
  router.use(authenticate);

  router.get("/", authorize("hierarchy:view", "hierarchy:manage"), parseQuery(hierarchyQueryDto), hierarchyController.list);
  router.get("/placements", authorize("hierarchy:view", "hierarchy:manage"), hierarchyController.placements);
  router.post("/", authorize("hierarchy:manage"), validate(createHierarchyDto), hierarchyController.create);
  router.get("/:id", authorize("hierarchy:view", "hierarchy:manage"), hierarchyController.get);
  router.get("/:id/users", authorize("hierarchy:view", "hierarchy:manage"), parseQuery(eligibleUserQueryDto), hierarchyController.eligibleUsers);
  router.post("/:id/nodes", authorize("hierarchy:manage"), validate(addHierarchyNodeDto), hierarchyController.addNode);
  router.delete("/:id/nodes/:nodeId", authorize("hierarchy:manage"), validate(removeHierarchyNodeDto), hierarchyController.removeNode);
  router.post("/:id/activate", authorize("hierarchy:manage"), validate(versionDto), hierarchyController.activate);
  router.post("/:id/archive", authorize("hierarchy:manage"), validate(versionDto), hierarchyController.archive);
  router.get("/:id/history", authorize("hierarchy:view", "hierarchy:manage"), hierarchyController.history);

  return router;
}

module.exports = { createHierarchyRoutes };
