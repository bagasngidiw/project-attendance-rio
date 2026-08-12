/**
 * Password policy domain model (FR-044).
 *
 * A single platform-wide policy is enforced at every credential change point
 * (initial provisioning, admin reset, self change). The model is pure and
 * framework-free: structural validation of the policy itself, password
 * validation (length + complexity), and expiry checks.
 *
 * Reuse-of-recent-passwords is checked against the user's bounded password
 * history. History entries are hashes, so the hash comparison is injected by
 * the application layer (keeps this file free of crypto dependencies).
 */

const { ValidationError } = require("./errors");

/** Default policy per design §3.2 (corporate best practice). */
const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
  maxLength: 128,
  expiryDays: 90, // 0 = passwords never expire
  historyLength: 5, // number of recent hashes a new password must differ from
});

/** Character-class checks used by validatePassword. */
const UPPERCASE_RE = /[A-Z]/;
const LOWERCASE_RE = /[a-z]/;
const DIGIT_RE = /[0-9]/;
const SPECIAL_RE = /[^A-Za-z0-9]/;

/**
 * Structurally validates a policy object, returning a normalized policy.
 * Throws ValidationError when the policy is malformed.
 *
 * @param {Partial<PasswordPolicy>} policy
 * @returns {PasswordPolicy}
 */
function validatePolicy(policy = {}) {
  const minLength = Number.isInteger(policy.minLength) ? policy.minLength : DEFAULT_PASSWORD_POLICY.minLength;
  const maxLength = Number.isInteger(policy.maxLength) ? policy.maxLength : DEFAULT_PASSWORD_POLICY.maxLength;
  const historyLength = Number.isInteger(policy.historyLength) ? policy.historyLength : DEFAULT_PASSWORD_POLICY.historyLength;
  const expiryDays = Number.isInteger(policy.expiryDays) ? policy.expiryDays : DEFAULT_PASSWORD_POLICY.expiryDays;

  if (minLength < 8) {
    throw new ValidationError("minLength must be at least 8.", { field: "minLength" });
  }
  if (maxLength < minLength) {
    throw new ValidationError("maxLength must be >= minLength.", { field: "maxLength" });
  }
  if (historyLength < 0 || historyLength > 20) {
    throw new ValidationError("historyLength must be between 0 and 20.", { field: "historyLength" });
  }
  if (expiryDays < 0) {
    throw new ValidationError("expiryDays must be >= 0 (0 disables expiry).", { field: "expiryDays" });
  }

  return {
    minLength,
    requireUppercase: policy.requireUppercase ?? DEFAULT_PASSWORD_POLICY.requireUppercase,
    requireLowercase: policy.requireLowercase ?? DEFAULT_PASSWORD_POLICY.requireLowercase,
    requireDigit: policy.requireDigit ?? DEFAULT_PASSWORD_POLICY.requireDigit,
    requireSpecial: policy.requireSpecial ?? DEFAULT_PASSWORD_POLICY.requireSpecial,
    maxLength,
    expiryDays,
    historyLength,
  };
}

/**
 * Validates a password against the policy's length + complexity rules.
 *
 * @param {PasswordPolicy} policy
 * @param {string} password
 * @returns {{ valid: boolean, violations: string[] }}
 */
function validatePassword(policy, password) {
  const violations = [];
  const value = String(password ?? "");

  if (value.length < policy.minLength) {
    violations.push(`Must be at least ${policy.minLength} characters.`);
  }
  if (value.length > policy.maxLength) {
    violations.push(`Must be no more than ${policy.maxLength} characters.`);
  }
  if (policy.requireUppercase && !UPPERCASE_RE.test(value)) {
    violations.push("Must contain an uppercase letter.");
  }
  if (policy.requireLowercase && !LOWERCASE_RE.test(value)) {
    violations.push("Must contain a lowercase letter.");
  }
  if (policy.requireDigit && !DIGIT_RE.test(value)) {
    violations.push("Must contain a digit.");
  }
  if (policy.requireSpecial && !SPECIAL_RE.test(value)) {
    violations.push("Must contain a special character.");
  }

  return { valid: violations.length === 0, violations };
}

/**
 * True when the password is one of the recent history hashes (reuse).
 * Async because hash verification requires the bcrypt hasher (injected).
 *
 * @param {string} password
 * @param {string[]} passwordHistory bounded array of recent bcrypt hashes
 * @param {object} passwordHasher implements `verify(plain, hash)`
 * @returns {Promise<boolean>}
 */
async function isPasswordReused(password, passwordHistory, passwordHasher) {
  for (const hash of passwordHistory ?? []) {
    if (!hash) continue;
    // eslint-disable-next-line no-await-in-loop -- sequential verify avoids bcrypt CPU spikes
    const matches = await passwordHasher.verify(password, hash);
    if (matches) return true;
  }
  return false;
}

/**
 * True when the password must be changed because it expired under the policy.
 *
 * @param {PasswordPolicy} policy
 * @param {Date|string|null} passwordChangedAt
 * @param {Date} [now]
 * @returns {boolean}
 */
function isExpired(policy, passwordChangedAt, now = new Date()) {
  if (!policy.expiryDays || !passwordChangedAt) return false;
  const changedAt = new Date(passwordChangedAt);
  if (Number.isNaN(changedAt.getTime())) return false;
  const cutoff = new Date(changedAt.getTime() + policy.expiryDays * 24 * 60 * 60 * 1000);
  return now.getTime() > cutoff.getTime();
}

module.exports = {
  DEFAULT_PASSWORD_POLICY,
  validatePolicy,
  validatePassword,
  isPasswordReused,
  isExpired,
};
