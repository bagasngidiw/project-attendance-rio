const { z } = require("zod");

const hierarchyQueryDto = z.object({
  contractTypeId: z.string().min(1).optional(),
  placementId: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});

const createHierarchyDto = z.object({
  contractTypeId: z.string().min(1),
  placementId: z.string().min(1),
});

const eligibleUserQueryDto = z.object({
  search: z.string().max(128).optional().default(""),
  includeAssigned: z.coerce.boolean().optional().default(false),
});

const addHierarchyNodeDto = z.object({
  userId: z.string().min(1),
  anchorNodeId: z.string().min(1).nullable().optional(),
  relation: z.enum(["ROOT", "CHILD", "PARENT", "SIBLING_BEFORE", "SIBLING_AFTER"]),
  expectedVersion: z.number().int().positive(),
});

const removeHierarchyNodeDto = z.object({
  expectedVersion: z.number().int().positive(),
  promoteChildren: z.boolean().optional().default(false),
});

const versionDto = z.object({ expectedVersion: z.number().int().positive() });

module.exports = {
  hierarchyQueryDto,
  createHierarchyDto,
  eligibleUserQueryDto,
  addHierarchyNodeDto,
  removeHierarchyNodeDto,
  versionDto,
};
