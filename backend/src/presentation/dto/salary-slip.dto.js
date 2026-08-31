/**
 * Salary-slip DTOs (FR-006) — Zod schemas for the upload body (multipart
 * text fields) and the list query params. File bytes are handled by multer.
 */

const { z } = require("zod");

const salarySlipCreateDto = z.object({
  userId: z.string().min(1),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal gajian harus berformat YYYY-MM-DD."),
  periodLabel: z.string().trim().min(1).max(64),
  notes: z.string().trim().max(512).optional(),
});

const salarySlipListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

module.exports = { salarySlipCreateDto, salarySlipListQuerySchema };