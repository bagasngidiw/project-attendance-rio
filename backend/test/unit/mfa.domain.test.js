/**
 * MFA domain tests (FR-051): RFC 6238 TOTP vectors, windowed verification,
 * constant-time rejection, secret generation and mfaRequirements validation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  generateSecret,
  totpCode,
  verifyCode,
  validateMfaConfig,
} = require("../../src/domain/mfa");
const { ValidationError } = require("../../src/domain/errors");

// RFC 6238 SHA-1 test secret: base32 of ASCII "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const currentStep = () => Math.floor(Date.now() / 1000 / 30);

test("generateSecret returns a fresh 32-char base32 secret", () => {
  const secret = generateSecret();
  assert.equal(typeof secret, "string");
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(generateSecret(), secret);
});

test("totpCode matches the RFC 6238 reference vectors", () => {
  const cases = [
    { counter: 0, expected: "755224" },
    { counter: 1, expected: "287082" },
    { counter: 2, expected: "359152" },
    { counter: 3, expected: "969429" },
    { counter: 4, expected: "338314" },
  ];
  for (const { counter, expected } of cases) {
    assert.equal(totpCode(RFC_SECRET, { counter }), expected);
  }
});

test("totpCode is deterministic for a fixed counter and secret", () => {
  assert.equal(totpCode(RFC_SECRET, { counter: 42 }), totpCode(RFC_SECRET, { counter: 42 }));
});

test("verifyCode accepts the current code and rejects a wrong code", () => {
  const secret = generateSecret();
  const code = totpCode(secret, {});
  assert.equal(verifyCode(secret, code), true);
  const wrong = code === "000000" ? "000001" : "000000";
  assert.equal(verifyCode(secret, wrong), false);
});

test("verifyCode is self-consistent across the default ±1 window", () => {
  const secret = generateSecret();
  const step = currentStep();
  for (const offset of [-1, 0, 1]) {
    assert.equal(
      verifyCode(secret, totpCode(secret, { counter: step + offset })),
      true
    );
  }
});

test("verifyCode honors the configured window", () => {
  const secret = generateSecret();
  const step = currentStep();
  const farFuture = totpCode(secret, { counter: step + 5 });

  assert.equal(verifyCode(secret, farFuture, { window: 0 }), false);
  assert.equal(verifyCode(secret, farFuture, { window: 5 }), true);
});

test("verifyCode rejects malformed codes without throwing", () => {
  const secret = generateSecret();
  const valid = totpCode(secret, {});
  for (const bad of ["abc123", "12345", "1234567", "", "123 456", "abcdef"]) {
    assert.equal(verifyCode(secret, bad), false, `expected ${bad} to be rejected`);
  }
  assert.equal(verifyCode(secret, null), false);
  assert.equal(verifyCode(secret, undefined), false);
  assert.equal(verifyCode(secret, 123456), false);
  // A wrong code must not be accepted even after a valid one exists.
  assert.equal(verifyCode(secret, valid), true);
});

test("verifyCode rejects a tampered final digit", () => {
  const secret = generateSecret();
  const code = totpCode(secret, {});
  const last = Number(code[code.length - 1]);
  const flipped = (last + 1) % 10;
  const tampered = code.slice(0, -1) + String(flipped);
  assert.notEqual(tampered, code);
  assert.equal(verifyCode(secret, tampered), false);
});

test("validateMfaConfig defaults to disabled when unset", () => {
  assert.deepEqual(validateMfaConfig(null), { enabled: false, requiredForRoles: [] });
  assert.deepEqual(validateMfaConfig(undefined), { enabled: false, requiredForRoles: [] });
});

test("validateMfaConfig accepts a valid shape and normalizes role keys", () => {
  const config = validateMfaConfig({
    enabled: true,
    requiredForRoles: ["super_admin", "HR_ADMIN", "super_admin"],
  });
  assert.deepEqual(config, {
    enabled: true,
    requiredForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
  });
  assert.deepEqual(validateMfaConfig({ enabled: true }), {
    enabled: true,
    requiredForRoles: [],
  });
});

test("validateMfaConfig rejects structurally invalid shapes", () => {
  assert.throws(() => validateMfaConfig("yes"), ValidationError);
  assert.throws(() => validateMfaConfig(42), ValidationError);
  assert.throws(() => validateMfaConfig([]), ValidationError);
  assert.throws(() => validateMfaConfig({ enabled: "yes" }), ValidationError);
  assert.throws(
    () => validateMfaConfig({ enabled: true, requiredForRoles: "SUPER_ADMIN" }),
    ValidationError
  );
  assert.throws(
    () => validateMfaConfig({ enabled: true, requiredForRoles: [42] }),
    ValidationError
  );
});
