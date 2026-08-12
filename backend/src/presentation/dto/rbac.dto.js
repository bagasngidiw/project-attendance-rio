/**
 * RBAC DTOs — Zod validation for role assignment (design §5.1/§5.3).
 */

const { z } = require("zod");

const assignRolesDto = z.object({
  roleIds: z
    .array(z.string().min(1, "Role id is required."))
    .min(1, "At least one role must be provided.")
    .max(20, "Too many roles."),
});

module.exports = { assignRolesDto };
