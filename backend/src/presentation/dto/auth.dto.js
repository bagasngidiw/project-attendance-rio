/**
 * Auth DTOs — Zod validation mirrors the frontend schema (design §5.3).
 * Validation happens at the boundary so application services never see
 * malformed input.
 */

const { z } = require("zod");

const usernameSchema = z
  .string()
  .min(2, "Username must be at least 2 characters.")
  .max(64, "Username must be at most 64 characters.")
  .transform((value) => value.trim().toLowerCase());

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

const refreshTokenSchema = z
  .string()
  .min(10, "Refresh token is malformed.");

const signInDto = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

const refreshDto = z.object({
  refreshToken: refreshTokenSchema,
});

const signOutDto = z.object({
  refreshToken: refreshTokenSchema,
});

module.exports = {
  signInDto,
  refreshDto,
  signOutDto,
  passwordSchema,
};
