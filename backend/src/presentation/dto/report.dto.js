/**
 * Report DTOs (FR-018 / FR-019) — shared filter model (screen + export) and
 * the export format parameter.
 */

const { z } = require("zod");

const reportFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  // FR-003: free-text name/username search; `employeeId` stays for API compat.
  employeeSearch: z.string().optional(),
  employeeId: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// FR-006: PDF export removed — only Excel is supported (format=pdf → 400).
const exportFormatSchema = z.enum(["excel"]);

module.exports = { reportFiltersSchema, exportFormatSchema };
