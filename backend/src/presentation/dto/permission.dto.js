/**
 * Permission (Ijin) DTOs (FR-007) — submission payload with an optional
 * approval target.
 */

const { z } = require("zod");

const approvalTargetSchema = z
  .object({
    targetType: z.enum(["ROLE", "USER"]),
    targetRoleId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .optional();

const permissionSubmitDto = z.object({
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  reason: z.string().min(1),
  approvalTarget: approvalTargetSchema,
});

module.exports = { permissionSubmitDto };
