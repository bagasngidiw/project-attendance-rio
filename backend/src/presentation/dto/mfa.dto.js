/**
 * MFA DTOs (FR-051) — boundary validation for MFA endpoints. Enroll and
 * disable carry no payload; confirm and verify validate the presented code.
 */

const { z } = require("zod");

const mfaCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "Code must be a 6-digit number.");

const mfaConfirmDto = z.object({
  code: mfaCodeSchema,
});

const mfaVerifyDto = z.object({
  mfaChallengeToken: z
    .string()
    .min(10, "MFA challenge token is malformed."),
  code: mfaCodeSchema,
});

module.exports = { mfaCodeSchema, mfaConfirmDto, mfaVerifyDto };
