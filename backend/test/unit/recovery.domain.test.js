/**
 * Recovery domain tests (FR-045): token generation/hashing and request
 * identifier validation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  RECOVERY_PURPOSE,
  generateRecoveryToken,
  hashToken,
  validateRecoveryRequest,
} = require("../../src/domain/recovery");
const { ValidationError } = require("../../src/domain/errors");

test("RECOVERY_PURPOSE is the password-reset discriminator", () => {
  assert.equal(RECOVERY_PURPOSE, "PASSWORD_RESET");
});

test("generateRecoveryToken produces unique URL-safe tokens", () => {
  const first = generateRecoveryToken();
  const second = generateRecoveryToken();
  assert.ok(first.length > 0);
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
});

test("hashToken is a deterministic sha256 hex digest", () => {
  const hash = hashToken("opaque-token-value");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashToken("opaque-token-value"), hash);
  assert.notEqual(hashToken("other-token-value"), hash);
});

test("hashToken never returns the plaintext token", () => {
  const token = generateRecoveryToken();
  assert.notEqual(hashToken(token), token);
});

test("validateRecoveryRequest accepts a trimmed identifier", () => {
  assert.deepEqual(validateRecoveryRequest({ identifier: "  alice@corp.io  " }), {
    identifier: "alice@corp.io",
  });
  assert.deepEqual(validateRecoveryRequest({ identifier: "alice" }), {
    identifier: "alice",
  });
});

test("validateRecoveryRequest rejects missing or empty identifiers", () => {
  assert.throws(() => validateRecoveryRequest({}), ValidationError);
  assert.throws(() => validateRecoveryRequest({ identifier: "" }), ValidationError);
  assert.throws(() => validateRecoveryRequest({ identifier: "   " }), ValidationError);
  assert.throws(() => validateRecoveryRequest(null), ValidationError);
});

test("validateRecoveryRequest rejects identifiers longer than 255 chars", () => {
  assert.throws(
    () => validateRecoveryRequest({ identifier: "x".repeat(256) }),
    ValidationError
  );
});
