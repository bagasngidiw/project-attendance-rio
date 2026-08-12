/**
 * RBAC console DTOs — Zod validation for FR-011 endpoints.
 */

const { z } = require("zod");
const { PERMISSION_DEFINITIONS } = require("../../domain/permissions");
const { ROLE_DATA_SCOPES } = require("../../domain/role-level");

const permissionKeySchema = z
  .string()
  .refine((key) => PERMISSION_DEFINITIONS[key], {
    message: "Unknown permission key.",
  });

const dataScopeSchema = z.enum(ROLE_DATA_SCOPES);

const createRoleDto = z.object({
  name: z.string().min(2, "Role name must be at least 2 characters.").max(64),
  description: z.string().max(512).optional().default(""),
  permissions: z.array(permissionKeySchema).min(1, "At least one permission is required."),
  // FR-064: role level + scope (optional; defaults applied).
  level: z.number().int().min(1).max(1000).optional(),
  levelLabel: z.string().max(64).optional(),
  dataScope: dataScopeSchema.optional(),
  // FR-064: template or copy-source for the wizard (optional).
  templateKey: z.string().max(64).optional(),
  copyFromRoleId: z.string().min(1).optional(),
});

const updateRoleDto = z.object({
  name: z.string().min(2).max(64).optional(),
  description: z.string().max(512).optional(),
  level: z.number().int().min(1).max(1000).optional(),
  levelLabel: z.string().max(64).optional(),
  dataScope: dataScopeSchema.optional(),
  expectedVersion: z.number().int().positive(),
});

const setPermissionsDto = z.object({
  permissions: z.array(permissionKeySchema),
  reason: z.string().max(512).optional().default(""),
  expectedVersion: z.number().int().positive(),
});

const toggleRoleStatusDto = z.object({
  expectedVersion: z.number().int().positive(),
});

// FR-064: validate-before-save payload (no persistence).
const validateRoleDto = z.object({
  permissions: z.array(permissionKeySchema),
  level: z.number().int().min(1).max(1000).optional(),
  levelLabel: z.string().max(64).optional(),
  dataScope: dataScopeSchema.optional(),
});

module.exports = {
  createRoleDto,
  updateRoleDto,
  setPermissionsDto,
  toggleRoleStatusDto,
  validateRoleDto,
};
