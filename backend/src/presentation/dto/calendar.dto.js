/**
 * Calendar DTOs (FR-059) — holiday CRUD. Dates are company-timezone date keys
 * ("YYYY-MM-DD"); date-range semantics are enforced by the service.
 */

const { z } = require("zod");

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");

const createHolidayDto = z.object({
  date: dateKey,
  name: z.string().trim().min(1, "A name is required.").max(100),
  repeatYearly: z.boolean().optional().default(false),
});

const updateHolidayDto = z.object({
  date: dateKey.optional(),
  name: z.string().trim().min(1, "A name is required.").max(100).optional(),
  repeatYearly: z.boolean().optional(),
});

module.exports = { createHolidayDto, updateHolidayDto };
