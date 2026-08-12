/**
 * Manager team DTOs — Zod validation for FR-006 endpoints.
 */

const { z } = require("zod");

/** Query validation for the team overview list (page/pageSize reserved for future pagination). */
const teamOverviewQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const teamMemberParamsDto = z.object({
  memberId: z.string().min(1, "memberId is required."),
});

module.exports = {
  teamOverviewQueryDto,
  teamMemberParamsDto,
};
