/**
 * Placement master DTOs (NEW UPDATE TAD SIMBIKA).
 */

const { z } = require("zod");

const createPlacementDto = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(2).max(128),
  description: z.string().max(256).optional().default(""),
});

const updatePlacementDto = z.object({
  name: z.string().min(2).max(128).optional(),
  description: z.string().max(256).optional(),
});

module.exports = {
  createPlacementDto,
  updatePlacementDto,
};
