/**
 * Delegation DTOs (FR-009) — creation body. Dates are ISO strings; the domain
 * validates the range and normalizes them to Date.
 */

const { z } = require("zod");

const delegationCreateDto = z.object({
  delegateId: z.string().min(1, "delegateId is required."),
  requestTypes: z
    .array(z.enum(["leave", "overtime", "trip"]))
    .optional()
    .default([]),
  startsAt: z.string().min(1, "startsAt is required."),
  endsAt: z.string().min(1, "endsAt is required."),
});

module.exports = { delegationCreateDto };
