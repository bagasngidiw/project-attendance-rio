/**
 * Overtime admin DTOs (FR-055) — HR review query filters + correction body.
 */

const { z } = require("zod");

const overtimeAdminQueryDto = z.object({
  employeeId: z.string().optional(),
  departmentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z
    .enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const overtimeCorrectionDto = z.object({
  field: z.string().min(1, "A field is required."),
  oldValue: z.any().nullable().optional(),
  newValue: z.any().nullable().optional(),
  reason: z.string().min(1, "A correction reason is required.").max(512),
});

module.exports = { overtimeAdminQueryDto, overtimeCorrectionDto };
