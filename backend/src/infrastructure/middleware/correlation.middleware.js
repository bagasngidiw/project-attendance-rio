/**
 * Correlation middleware — generates (or accepts) a request correlation id
 * and exposes it on `req.correlationId` so every audit/activity event emitted
 * during the request can be traced across both surfaces (FR-012/FR-013).
 */

const { generateCorrelationId } = require("../../domain/audit");

function createCorrelationMiddleware() {
  return function correlationMiddleware(req, res, next) {
    const incoming = req.headers["x-correlation-id"];
    req.correlationId =
      incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
        ? incoming
        : generateCorrelationId();
    next();
  };
}

module.exports = { createCorrelationMiddleware };
