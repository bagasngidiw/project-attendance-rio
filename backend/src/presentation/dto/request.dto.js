/**
 * Shared request DTOs (FR-016 / FR-002) — cancellation + rejection bodies,
 * and the mine-query filters. The status filter accepts the agents.md API
 * vocabulary (PENDING_APPROVAL) and the internal code for compatibility.
 */

const { z } = require("zod");

const cancelRequestDto = z.object({
  reason: z.string().max(512).optional().default(""),
});

const rejectRequestDto = z.object({
  reason: z.string().min(1, "A rejection reason is required.").max(512),
});

const editRequestDto = z.object({
  payload: z.record(z.string(), z.unknown()),
});

const mineQuerySchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  type: z.enum(["LEAVE", "OVERTIME", "TRIP", "PERMISSION", "SAKIT"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

module.exports = { cancelRequestDto, rejectRequestDto, editRequestDto, mineQuerySchema };
