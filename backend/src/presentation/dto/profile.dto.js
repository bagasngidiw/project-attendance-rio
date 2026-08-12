/**
 * Profile DTOs (FR-021) — self-service update body. Unknown/HR-managed keys
 * pass through to the domain (passthrough) so they are rejected with
 * FIELD_NOT_EDITABLE rather than silently stripped.
 */

const { z } = require("zod");

const updateProfileDto = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().max(256).optional(),
    address: z.string().max(256).optional(),
    emergencyContact: z.string().max(256).optional(),
    personalEmail: z.string().trim().toLowerCase().email().optional(),
    bankAccount: z.string().max(256).optional(),
  })
  .passthrough();

module.exports = { updateProfileDto };
