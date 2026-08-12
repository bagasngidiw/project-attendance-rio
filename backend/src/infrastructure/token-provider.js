/**
 * JwtTokenProvider — issues and validates short-lived signed access tokens.
 *
 * Tokens carry only identity claims (sub, email, roles, permission keys) and
 * the `ver` claim used for server-side invalidation on role/permission
 * changes. HS256 with a shared secret is used; cloud deployments may swap in
 * RS256 by extending this provider.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

class JwtTokenProvider {
  /**
   * @param {object} options
   * @param {string} options.secret
   * @param {string} options.issuer
   * @param {string} options.audience
   * @param {number} options.ttlSeconds
   */
  constructor({ secret, issuer, audience, ttlSeconds }) {
    this.secret = secret;
    this.issuer = issuer;
    this.audience = audience;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * @param {object} payload identity claims
   * @param {string} payload.sub user id
   * @param {string} payload.email
   * @param {string[]} payload.roles
   * @param {string[]} payload.permissions
   * @param {number} payload.ver token version
   * @param {string} payload.sessionId owning session id (design §4.5)
   * @returns {Promise<string>} signed JWT
   */
  sign({
    sub,
    email,
    roles,
    permissions,
    ver,
    sessionId,
  }) {
    return jwt.sign(
      {
        email,
        roles,
        permissions,
        ver,
        sessionId,
      },
      this.secret,
      {
        subject: sub,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.ttlSeconds,
        algorithm: "HS256",
      }
    );
  }

  /**
   * Verifies signature, issuer, audience and expiry.
   *
   * @param {string} token
   * @returns {object} decoded payload
   */
  verify(token) {
    return jwt.verify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["HS256"],
    });
  }
}

/**
 * Opaque, cryptographically random token for refresh sessions. Only the SHA-256
 * hash is ever persisted — the raw token is the equivalent of a password.
 */
function generateOpaqueToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { JwtTokenProvider, generateOpaqueToken, hashOpaqueToken };
