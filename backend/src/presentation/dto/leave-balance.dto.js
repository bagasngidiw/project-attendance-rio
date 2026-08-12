/**
 * Leave balance DTOs (FR-022).
 */

const { z } = require("zod");

const adjustBalanceDto = z.object({
  leaveTypeId: z.string().min(1),
  year: z.number().int().min(2000),
  deltaDays: z
    .number()
    .refine((value) => Number.isFinite(value) && value !== 0, {
      message: "deltaDays must be a non-zero number.",
    }),
  reason: z.string().trim().min(1, "A reason is required.").max(512),
});

module.exports = { adjustBalanceDto };
