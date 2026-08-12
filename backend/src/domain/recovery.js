/**
 * Password recovery domain model (FR-045).
 *
 * Pure, framework-free helpers: opaque one-time recovery-token generation,
 * one-way token hashing for at-rest storage, and structural validation of a
 * recovery request. No persistence and no application dependencies.
 */

const crypto = require("crypto");
const { ValidationError } = require("./errors");

/** Purpose discriminator used for password-reset recovery tokens. */
const RECOVERY_PURPOSE = "PASSWORD_RESET";

/** 32 random bytes encoded URL-safe (43 chars). Never stored in the clear. */
function generateRecoveryToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * One-way SHA-256 hex digest of a recovery token — the only form persisted,
 * so a database leak cannot be replayed to reset passwords.
 *
 * @param {string} token
 * @returns {string} 64-char hex digest
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Validates + normalizes a recovery request identifier (username or email).
 *
 * @param {{ identifier?: unknown }} input
 * @returns {{ identifier: string }} trimmed identifier
 */
function validateRecoveryRequest(input) {
  const identifier = String(input?.identifier ?? "").trim();
  if (!identifier || identifier.length > 255) {
    throw new ValidationError(
      "A username or email (1-255 characters) is required to request recovery.",
      { field: "identifier" }
    );
  }
  return { identifier };
}

module.exports = {
  RECOVERY_PURPOSE,
  generateRecoveryToken,
  hashToken,
  validateRecoveryRequest,
};
