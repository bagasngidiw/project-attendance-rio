/**
 * Platform settings DTOs (FR-044) — password policy shape validated at the
 * HTTP boundary; structural rules mirror `domain/password-policy.validatePolicy`.
 */

const { z } = require("zod");

const passwordPolicyDto = z.object({
  minLength: z.number().int().min(8).max(64),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireDigit: z.boolean(),
  requireSpecial: z.boolean(),
  maxLength: z.number().int().min(8).max(256),
  expiryDays: z.number().int().min(0).max(3650),
  historyLength: z.number().int().min(0).max(20),
});

module.exports = { passwordPolicyDto };
