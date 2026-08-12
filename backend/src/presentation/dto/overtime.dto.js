/**
 * Overtime submission DTO (FR-054). Time fields are HH:MM; the domain
 * enforces endTime > startTime.
 */

const { z } = require("zod");

/** FR-002/FR-004: requester-chosen approval target (role or specific user). */
const approvalTargetSchema = z
  .object({
    targetType: z.enum(["ROLE", "USER"]),
    targetRoleId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .optional();

const overtimeSubmitDto = z.object({
  date: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime must be HH:MM."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime must be HH:MM."),
  reason: z.string().min(1, "A reason is required.").max(512),
  approvalTarget: approvalTargetSchema,
});

module.exports = { overtimeSubmitDto };
