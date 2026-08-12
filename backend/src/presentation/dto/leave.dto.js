/**
 * Leave submission DTO (FR-036). Shape validated here; date-range semantics
 * are enforced by the domain `validateLeavePayload`.
 */

const { z } = require("zod");

/** FR-002/FR-006: requester-chosen approval target (role or specific user). */
const approvalTargetSchema = z
  .object({
    targetType: z.enum(["ROLE", "USER"]),
    targetRoleId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .optional();

const leaveSubmitDto = z.object({
  // Leave types are configurable (FR-058); registration is enforced by the
  // service against the active leave-type registry.
  leaveType: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(512),
  approvalTarget: approvalTargetSchema,
});

module.exports = { leaveSubmitDto };
