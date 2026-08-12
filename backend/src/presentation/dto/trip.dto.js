/**
 * Business trip submission DTO (FR-054).
 */

const { z } = require("zod");

/** FR-002/FR-005: requester-chosen approval target (role or specific user). */
const approvalTargetSchema = z
  .object({
    targetType: z.enum(["ROLE", "USER"]),
    targetRoleId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .optional();

const tripSubmitDto = z.object({
  destination: z.string().min(1, "A destination is required.").max(256),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  purpose: z.string().min(1, "A purpose is required.").max(512),
  approvalTarget: approvalTargetSchema,
});

module.exports = { tripSubmitDto };
