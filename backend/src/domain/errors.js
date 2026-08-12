/**
 * Domain error taxonomy.
 *
 * All errors thrown across the application are instances of one of these
 * typed errors. The presentation layer maps each error to an HTTP response
 * via the centralized error mapper, so no internal details ever leak to the
 * wire.
 */

class DomainError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class InvalidCredentialsError extends DomainError {
  constructor() {
    super("AUTH_INVALID_CREDENTIALS", "Invalid username or password.");
  }
}

class AccountInactiveError extends DomainError {
  constructor() {
    super(
      "AUTH_ACCOUNT_INACTIVE",
      "This account is not active. Contact your administrator."
    );
  }
}

class AccountLockedError extends DomainError {
  constructor(retryAfterMs) {
    super(
      "AUTH_ACCOUNT_LOCKED",
      "Too many failed sign-in attempts. Try again later.",
      { retryAfterMs }
    );
  }
}

class UnauthenticatedError extends DomainError {
  constructor(message = "Authentication required.") {
    super("AUTH_UNAUTHENTICATED", message);
  }
}

class TokenInvalidError extends DomainError {
  constructor(message = "Session token is invalid or expired.") {
    super("AUTH_TOKEN_INVALID", message);
  }
}

class RefreshTokenReuseError extends DomainError {
  constructor() {
    super(
      "AUTH_REFRESH_REUSE_DETECTED",
      "Session token was reused. Please sign in again."
    );
  }
}

class PermissionDeniedError extends DomainError {
  constructor(permissionKey) {
    super(
      "AUTH_PERMISSION_DENIED",
      "You do not have permission to perform this action.",
      { permissionKey }
    );
  }
}

class ValidationError extends DomainError {
  constructor(message, details) {
    super("VALIDATION_ERROR", message, details);
  }
}

class ConflictError extends DomainError {
  constructor(message, code = "CONFLICT") {
    super(code, message);
  }
}

class CurrentPasswordInvalidError extends DomainError {
  constructor() {
    super(
      "CURRENT_PASSWORD_INVALID",
      "The current password is incorrect.",
      { field: "currentPassword" }
    );
  }
}

class PasswordPolicyError extends DomainError {
  constructor(violations) {
    super(
      "PASSWORD_POLICY",
      "The password does not meet the platform policy.",
      { field: "newPassword", violations }
    );
  }
}

class NotFoundError extends DomainError {
  constructor(message = "Resource not found.", code = "NOT_FOUND") {
    super(code, message);
  }
}

class ReportUnavailableError extends DomainError {
  constructor(reportType) {
    super(
      "REPORT_UNAVAILABLE",
      `The "${reportType}" report has no data provider yet.`,
      { reportType }
    );
  }
}

class FieldNotEditableError extends DomainError {
  constructor(field) {
    super(
      "FIELD_NOT_EDITABLE",
      `Field "${field}" is managed by HR and cannot be edited here.`,
      { field }
    );
  }
}

class InternalServerError extends DomainError {
  constructor() {
    super("INTERNAL_ERROR", "An unexpected error occurred.");
  }
}

module.exports = {
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
  CurrentPasswordInvalidError,
  PasswordPolicyError,
  NotFoundError,
  ReportUnavailableError,
  FieldNotEditableError,
  InternalServerError,
};
