/**
 * Security headers middleware (design §4.5). Applies hardening headers to
 * every response before any route handler runs.
 */

function createSecurityHeaders() {
  return function securityHeaders(req, res, next) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  };
}

module.exports = { createSecurityHeaders };
