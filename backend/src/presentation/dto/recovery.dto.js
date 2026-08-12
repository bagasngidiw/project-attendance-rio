/**
 * Recovery DTOs (FR-045) — Zod validation at the HTTP boundary. Both recovery
 * endpoints are public (no authentication) and rely on the rate limiter for
 * abuse protection.
 */

const { z } = require("zod");

const recoveryRequestDto = z.object({
  identifier: z.string().trim().min(1).max(255),
});

const recoveryResetDto = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(8).max(128),
});

module.exports = { recoveryRequestDto, recoveryResetDto };
