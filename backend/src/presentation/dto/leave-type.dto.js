/**
 * Leave-type DTOs (FR-058).
 */

const { z } = require("zod");

const createLeaveTypeDto = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(2).max(64),
  description: z.string().max(256).optional().default(""),
  isBalanceBased: z.boolean().optional().default(false),
  maxDaysPerRequest: z.number().int().positive().optional().nullable(),
  requiredSupportingInfo: z.boolean().optional().default(false),
});

const updateLeaveTypeDto = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  description: z.string().max(256).optional(),
  isBalanceBased: z.boolean().optional(),
  maxDaysPerRequest: z.number().int().positive().optional().nullable(),
  requiredSupportingInfo: z.boolean().optional(),
});

/** TODO.md §6 "Tambahkan sendiri": key optional (derived from name). */
const suggestLeaveTypeDto = z.object({
  key: z.string().max(64).optional(),
  name: z.string().trim().min(2).max(64),
  description: z.string().max(256).optional().default(""),
});

module.exports = { createLeaveTypeDto, updateLeaveTypeDto, suggestLeaveTypeDto };
