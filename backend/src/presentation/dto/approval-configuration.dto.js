/**
 * Approval configuration DTOs (FR-001) — Superadmin config surface.
 */

const { z } = require("zod");

const requestTypeSchema = z.enum(["LEAVE", "OVERTIME", "TRIP", "PERMISSION", "SAKIT"]);

const roleConfigSchema = z.object({
  roleId: z.string().min(1),
  approvalLevel: z.number().int().min(0),
  canApprove: z.boolean().optional(),
  canBeTarget: z.boolean().optional(),
});

const updateConfigurationDto = z.object({
  roles: z.array(roleConfigSchema),
  selfApproval: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

module.exports = { requestTypeSchema, updateConfigurationDto };
