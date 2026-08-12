/**
 * MfaProvider — infrastructure helpers for MFA enrollment (FR-051).
 *
 * Wraps the domain secret format (`../domain/mfa`) into artifacts consumed
 * by authenticator apps: the `otpauth://` provisioning URI. A dedicated QR
 * library is intentionally not shipped in v1 — the frontend renders the URI
 * with its own QR generator or the user enters the secret manually.
 */

const DEFAULT_ISSUER = "HRIS Platform";

/**
 * Builds an `otpauth://totp/...` provisioning URI (Google Authenticator
 * key-uri format) for a secret + account.
 *
 * @param {object} input
 * @param {string} input.secret base32-encoded TOTP secret
 * @param {string} input.account user account label (username/email)
 * @param {string} [input.issuer="HRIS Platform"]
 * @returns {string}
 */
function buildOtpAuthUri({ secret, account, issuer = DEFAULT_ISSUER }) {
  if (!secret || !account) {
    throw new TypeError("secret and account are required.");
  }
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { buildOtpAuthUri, DEFAULT_ISSUER };
