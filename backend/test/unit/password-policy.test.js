/**
 * Password policy domain tests (FR-044): structural policy validation,
 * password validation (length + complexity), reuse detection, expiry.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PASSWORD_POLICY,
  validatePolicy,
  validatePassword,
  isPasswordReused,
  isExpired,
} = require("../../src/domain/password-policy");

test("DEFAULT_PASSWORD_POLICY enforces corporate defaults", () => {
  assert.equal(DEFAULT_PASSWORD_POLICY.minLength, 10);
  assert.equal(DEFAULT_PASSWORD_POLICY.requireUppercase, true);
  assert.equal(DEFAULT_PASSWORD_POLICY.requireLowercase, true);
  assert.equal(DEFAULT_PASSWORD_POLICY.requireDigit, true);
  assert.equal(DEFAULT_PASSWORD_POLICY.requireSpecial, true);
  assert.equal(DEFAULT_PASSWORD_POLICY.expiryDays, 90);
  assert.equal(DEFAULT_PASSWORD_POLICY.historyLength, 5);
});

test("validatePolicy normalizes a partial policy to defaults", () => {
  const policy = validatePolicy({ minLength: 12 });
  assert.equal(policy.minLength, 12);
  assert.equal(policy.maxLength, DEFAULT_PASSWORD_POLICY.maxLength);
  assert.equal(policy.expiryDays, DEFAULT_PASSWORD_POLICY.expiryDays);
});

test("validatePolicy rejects malformed policies", () => {
  assert.throws(() => validatePolicy({ minLength: 6 }), /minLength/);
  assert.throws(() => validatePolicy({ maxLength: 8, minLength: 12 }), /maxLength/);
  assert.throws(() => validatePolicy({ historyLength: -1 }), /historyLength/);
  assert.throws(() => validatePolicy({ expiryDays: -5 }), /expiryDays/);
});

test("validatePassword accepts a compliant password", () => {
  const { valid, violations } = validatePassword(DEFAULT_PASSWORD_POLICY, "SecurePass1!");
  assert.equal(valid, true);
  assert.deepEqual(violations, []);
});

test("validatePassword reports every missing complexity class", () => {
  const { valid, violations } = validatePassword(DEFAULT_PASSWORD_POLICY, "weakpass");
  assert.equal(valid, false);
  assert.ok(violations.some((v) => v.includes("uppercase")));
  assert.ok(violations.some((v) => v.includes("digit")));
  assert.ok(violations.some((v) => v.includes("special")));
});

test("validatePassword enforces length bounds", () => {
  const short = validatePassword(DEFAULT_PASSWORD_POLICY, "Ab1!x");
  assert.equal(short.valid, false);
  assert.ok(short.violations.some((v) => v.includes("at least 10")));

  const policy = validatePolicy({ ...DEFAULT_PASSWORD_POLICY, maxLength: 16 });
  const long = validatePassword(policy, "Abcdefghijklmnopq123!");
  assert.equal(long.valid, false);
  assert.ok(long.violations.some((v) => v.includes("no more than 16")));
});

test("isPasswordReused detects a match against history hashes", async () => {
  const hasher = {
    verify: async (plain, hash) => hash === `hashed:${plain}`,
  };
  const history = ["hashed:oldpass1", "hashed:recentpass"];
  assert.equal(await isPasswordReused("recentpass", history, hasher), true);
  assert.equal(await isPasswordReused("brandnew", history, hasher), false);
  assert.equal(await isPasswordReused("x", [], hasher), false);
});

test("isExpired respects expiryDays and passwordChangedAt", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const policy = validatePolicy({ expiryDays: 90 });

  // No changed-at -> never expired.
  assert.equal(isExpired(policy, null, now), false);
  // Changed 89 days ago -> not expired.
  const within = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
  assert.equal(isExpired(policy, within, now), false);
  // Changed 91 days ago -> expired.
  const past = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
  assert.equal(isExpired(policy, past, now), true);
  // expiryDays = 0 disables expiry.
  const never = validatePolicy({ expiryDays: 0 });
  assert.equal(isExpired(never, past, now), false);
});
