/**
 * Approval DTOs (FR-007 / FR-008 / FR-063) — decision body, escalation body,
 * and unified list/history filters.
 */

const { z } = require("zod");

const decideDto = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  // FR-063 U.6: the rejection comment is always optional; blank is stored blank.
  comment: z.string().max(512).optional().default(""),
  // FR-063 U.5.5: authorized higher-level admins may override cutoff blocks.
  overrideCutoff: z.boolean().optional().default(false),
});

const escalateDto = z.object({
  message: z.string().max(512).optional().default(""),
});

const approvalQuerySchema = z.object({
  type: z.enum(["LEAVE", "OVERTIME", "TRIP", "PERMISSION", "SAKIT"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const cutoffRuleDto = z.object({
  requestType: z.enum(["LEAVE", "TRIP", "OVERTIME", "*"]),
  days: z.array(z.number().int().min(0).max(6)).optional().default([]),
  fromTime: z.string().regex(/^\d{2}:\d{2}$/).optional().default(""),
  toTime: z.string().regex(/^\d{2}:\d{2}$/).optional().default(""),
  timezone: z.string().max(64).optional().default(""),
  dependsOn: z.string().max(64).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

module.exports = { decideDto, escalateDto, approvalQuerySchema, cutoffRuleDto };
