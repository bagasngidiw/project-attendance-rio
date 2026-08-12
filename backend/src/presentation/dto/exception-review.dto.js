/**
 * Exception review DTOs (FR-053) — review body + team query filters.
 */

const { z } = require("zod");

const exceptionReviewDto = z.object({
  outcome: z.enum(["CONFIRMED", "FLAGGED_HR", "REQUEST_CORRECTION"]),
  comment: z.string().max(500).default(""),
});

const exceptionTeamQueryDto = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(["NORMAL", "EXCEPTION"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

module.exports = { exceptionReviewDto, exceptionTeamQueryDto };
