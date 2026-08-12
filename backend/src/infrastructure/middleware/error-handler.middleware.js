/**
 * Centralized error mapper + not-found handler (design §5.3 / FR-033).
 *
 * Domain errors map to their HTTP status; everything else becomes a generic
 * 500 with no internal details leaked. Responses follow the
 * `{ data?, error? }` envelope.
 */

const {
  DomainError,
  InvalidCredentialsError,
  AccountInactiveError,
  AccountLockedError,
  UnauthenticatedError,
  TokenInvalidError,
  RefreshTokenReuseError,
  PermissionDeniedError,
  ValidationError,
  ConflictError,
  NotFoundError,
  ReportUnavailableError,
} = require("../../domain/errors");

const STATUS_BY_CLASS = new Map([
  [InvalidCredentialsError, 401],
  [AccountInactiveError, 403],
  [AccountLockedError, 423],
  [UnauthenticatedError, 401],
  [TokenInvalidError, 401],
  [RefreshTokenReuseError, 401],
  [PermissionDeniedError, 403],
  [ValidationError, 400],
  [ConflictError, 409],
  [NotFoundError, 404],
  [ReportUnavailableError, 422],
]);

/**
 * True when Mongoose could not cast a client-supplied value to a schema type
 * (e.g. a malformed `:id` path parameter for a 24-char ObjectId). Detected by
 * duck-typing so the mapper stays decoupled from the MongoDB driver.
 */
function isCastError(error) {
  return !!error && typeof error === "object" && error.name === "CastError";
}

/**
 * Maps a domain error to an HTTP status code.
 */
function statusFor(error) {
  // Plain-object errors (e.g. crafted by the authorize middleware) carry an
  // explicit status and must be honored.
  if (error && typeof error === "object" && Number.isInteger(error.status)) {
    return error.status;
  }
  // A value that cannot be cast to an identifier means the addressed resource
  // cannot exist: answer 404 (NOT_FOUND), never an internal 500.
  if (isCastError(error)) return 404;
  for (const [ErrorClass, status] of STATUS_BY_CLASS) {
    if (error instanceof ErrorClass) return status;
  }
  if (error instanceof DomainError) return 400;
  return 500;
}

/**
 * Maps a domain error to the RFC 7807-inspired wire shape. Unknown errors are
 * deliberately reduced to a generic message so internal details never leak.
 */
function toErrorBody(error) {
  const status = statusFor(error);
  // CastErrors never expose the offending value or the driver's stack — the
  // client only learns that the resource does not exist.
  if (isCastError(error)) {
    return { code: "NOT_FOUND", message: "Resource not found." };
  }
  const isSafe =
    error instanceof DomainError ||
    (error && typeof error === "object" && Number.isInteger(error.status));
  const body = {
    code: isSafe && error.code ? error.code : "INTERNAL_ERROR",
    message: isSafe && error.message
      ? error.message
      : "An unexpected error occurred.",
  };
  if (status === 423 && error.details?.retryAfterMs) {
    body.retryAfterMs = error.details.retryAfterMs;
  }
  if (error.details?.field) body.field = error.details.field;
  if (error.details?.permissionKey) {
    body.permissionKey = error.details.permissionKey;
  }
  if (Array.isArray(error.details?.violations)) {
    body.violations = error.details.violations;
  }
  return body;
}

function createErrorHandler({ logger = console } = {}) {
  // eslint-disable-next-line no-unused-vars -- Express requires 4 args.
  return function errorHandler(err, req, res, next) {
    const status = statusFor(err);
    if (status >= 500) {
      logger.error("[error-handler]", {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
      });
    }
    res.status(status).json({ error: toErrorBody(err) });
  };
}

function createNotFoundHandler() {
  return function notFound(req, res) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  };
}

module.exports = {
  createErrorHandler,
  createNotFoundHandler,
  statusFor,
  toErrorBody,
};
