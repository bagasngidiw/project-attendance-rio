/**
 * Dashboard DTOs (FR-026) — optional HR summary filters.
 */

const { z } = require("zod");

const hrFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

module.exports = { hrFiltersSchema };
