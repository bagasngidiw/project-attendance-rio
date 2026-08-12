/**
 * TOTP (RFC 6238) — pure domain functions for time-based one-time passwords
 * (FR-051). No I/O and no dependencies beyond Node's crypto.
 *
 * Defaults (HMAC-SHA1, 6 digits, 30s step, ±1 window) match the authenticator
 * configuration emitted by the `otpauth://` provisioning URIs.
 */

const crypto = require("crypto");
const { ValidationError } = require("./errors");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_TIME_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;

const BASE32_LOOKUP = new Map(
  [...BASE32_ALPHABET].map((char, index) => [char, index])
);

/**
 * Generates a fresh TOTP secret: 20 random bytes (160 bits) encoded as 32
 * unpadded base32 characters.
 *
 * @returns {string}
 */
function generateSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

/** Encodes a byte buffer as unpadded RFC 4648 base32. */
function encodeBase32(bytes) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return output;
}

/** Decodes unpadded RFC 4648 base32 (case-insensitive; tolerates spaces/-). */
function decodeBase32(secret) {
  const normalized = String(secret)
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "");
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE32_LOOKUP.get(char);
    if (value === undefined) {
      throw new TypeError(`Invalid base32 character: "${char}".`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Computes the TOTP code for a secret using HMAC-SHA1 with dynamic
 * truncation (RFC 4226 §5.3).
 *
 * @param {string} secret base32-encoded secret
 * @param {object} [options]
 * @param {number} [options.timeStepSeconds=30]
 * @param {number} [options.digits=6]
 * @param {number} [options.counter] fixed counter override (determinism/tests)
 * @returns {string} zero-padded digit code
 */
function totpCode(
  secret,
  {
    timeStepSeconds = DEFAULT_TIME_STEP_SECONDS,
    digits = DEFAULT_DIGITS,
    counter,
  } = {}
) {
  if (!secret || typeof secret !== "string") {
    throw new TypeError("A base32 secret is required.");
  }
  const step =
    counter ?? Math.floor(Date.now() / 1000 / timeStepSeconds);
  if (!Number.isInteger(step) || step < 0) {
    throw new TypeError("TOTP counter must be a non-negative integer.");
  }

  // 8-byte big-endian counter per RFC 6238 §5.1.
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(step), 0);

  const hmac = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();

  // Dynamic truncation: use the last nibble as the offset into the digest.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Verifies a presented code against the current time step ± `window` steps.
 * Every candidate is compared with a constant-time comparison so timing does
 * not reveal which step (if any) matched.
 *
 * @param {string} secret base32-encoded secret
 * @param {string} code presented code
 * @param {object} [options]
 * @param {number} [options.window=1] accepted steps on each side of now
 * @param {number} [options.timeStepSeconds=30]
 * @param {number} [options.digits=6]
 * @returns {boolean}
 */
function verifyCode(
  secret,
  code,
  {
    window = DEFAULT_WINDOW,
    timeStepSeconds = DEFAULT_TIME_STEP_SECONDS,
    digits = DEFAULT_DIGITS,
  } = {}
) {
  if (typeof code !== "string" || !/^\d+$/.test(code)) return false;
  const current = Math.floor(Date.now() / 1000 / timeStepSeconds);
  for (let step = current - window; step <= current + window; step += 1) {
    if (safeEqual(code, totpCode(secret, { counter: step, digits }))) {
      return true;
    }
  }
  return false;
}

/** Constant-time string comparison (same length required, else false). */
function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Validates and normalizes the `mfaRequirements` platform setting:
 * `{ enabled: boolean, requiredForRoles: string[] }`. `null`/`undefined`
 * resolve to the disabled default; role keys are uppercased and de-duplicated.
 *
 * @param {unknown} config stored setting value
 * @returns {{ enabled: boolean, requiredForRoles: string[] }}
 * @throws {ValidationError} when the shape is structurally invalid
 */
function validateMfaConfig(config) {
  if (config === null || config === undefined) {
    return { enabled: false, requiredForRoles: [] };
  }
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new ValidationError("mfaRequirements must be an object.", {
      field: "mfaRequirements",
    });
  }
  if (typeof config.enabled !== "boolean") {
    throw new ValidationError(
      "mfaRequirements.enabled must be a boolean.",
      { field: "mfaRequirements.enabled" }
    );
  }
  if (
    config.requiredForRoles !== undefined &&
    !Array.isArray(config.requiredForRoles)
  ) {
    throw new ValidationError(
      "mfaRequirements.requiredForRoles must be an array of role keys.",
      { field: "mfaRequirements.requiredForRoles" }
    );
  }
  const raw = config.requiredForRoles ?? [];
  if (raw.some((role) => typeof role !== "string")) {
    throw new ValidationError(
      "mfaRequirements.requiredForRoles must contain only role keys.",
      { field: "mfaRequirements.requiredForRoles" }
    );
  }
  return {
    enabled: config.enabled,
    requiredForRoles: [...new Set(raw.map((role) => role.toUpperCase()))],
  };
}

module.exports = {
  generateSecret,
  totpCode,
  verifyCode,
  validateMfaConfig,
  DEFAULT_TIME_STEP_SECONDS,
  DEFAULT_DIGITS,
  DEFAULT_WINDOW,
};
