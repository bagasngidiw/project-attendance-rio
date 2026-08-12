/**
 * Sakit (Sickness) DTOs (TODO.md §3) + Sickness-type master DTOs (§5/§6).
 */

const { z } = require("zod");

const approvalTargetSchema = z
  .object({
    targetType: z.enum(["ROLE", "USER"]),
    targetRoleId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .optional();

const sakitSubmitDto = z.object({
  sicknessType: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  reason: z.string().min(1),
  approvalTarget: approvalTargetSchema,
});

const createSicknessTypeDto = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(2).max(128),
  description: z.string().max(256).optional().default(""),
});

const suggestSicknessTypeDto = z.object({
  key: z.string().max(64).optional(),
  name: z.string().min(2).max(128),
  description: z.string().max(256).optional().default(""),
});

const updateSicknessTypeDto = z.object({
  name: z.string().min(2).max(128).optional(),
  description: z.string().max(256).optional(),
});

module.exports = {
  sakitSubmitDto,
  createSicknessTypeDto,
  suggestSicknessTypeDto,
  updateSicknessTypeDto,
};
