/**
 * Organization DTOs (FR-024) — departments and positions.
 */

const { z } = require("zod");

const createDepartmentDto = z.object({
  name: z.string().trim().min(2).max(128),
  code: z.string().trim().max(16).optional().default(""),
  description: z.string().trim().max(512).optional().default(""),
});

const updateDepartmentDto = z.object({
  name: z.string().trim().min(2).max(128).optional(),
  code: z.string().trim().max(16).optional(),
  description: z.string().trim().max(512).optional(),
});

const createPositionDto = z.object({
  name: z.string().trim().min(2).max(128),
  description: z.string().trim().max(512).optional().default(""),
});

const updatePositionDto = z.object({
  name: z.string().trim().min(2).max(128).optional(),
  description: z.string().trim().max(512).optional(),
});

module.exports = {
  createDepartmentDto,
  updateDepartmentDto,
  createPositionDto,
  updatePositionDto,
};
