/**
 * Profile domain model (FR-021).
 *
 * The self-service editable-field registry is the single source of truth for
 * what an employee may update on their own profile. Everything else
 * (identity, status, org placement, roles) is HR-managed and rejected on
 * employee updates. Field validators keep the domain pure.
 */

const { Email } = require("./model");
const { ValidationError, FieldNotEditableError } = require("./errors");

/** Editable by the employee on their own profile (FR-021 §3.1). */
const SELF_SERVICE_FIELDS = Object.freeze([
  "email",
  "phone",
  "address",
  "emergencyContact",
  "personalEmail",
  "bankAccount",
]);

/** Read-only for employees; managed via user lifecycle (FR-029) and org (FR-024). */
const HR_MANAGED_FIELDS = Object.freeze([
  "name",
  "username",
  "status",
  "departmentId",
  "positionId",
  "managerId",
  "roles",
]);

/** True when a field may be updated by the employee themselves. */
function isSelfServiceField(field) {
  return SELF_SERVICE_FIELDS.includes(field);
}

/**
 * Rejects any update targeting HR-managed fields (FR-021 §5.1). Throws a
 * FieldNotEditableError naming the first offending field.
 *
 * @param {object} update
 */
function assertEditableFields(update) {
  const rejected = Object.keys(update).filter((key) => !isSelfServiceField(key));
  if (rejected.length > 0) {
    throw new FieldNotEditableError(rejected[0]);
  }
}

/**
 * Validates self-service field values (FR-021 §4.4): email shape, phone and
 * text field length bounds.
 *
 * @param {object} update
 */
function validateProfileUpdate(update) {
  if (update.email !== undefined && update.email !== "") {
    new Email(update.email);
  }
  if (update.personalEmail !== undefined && update.personalEmail !== "") {
    new Email(update.personalEmail);
  }
  for (const key of ["phone", "address", "emergencyContact", "bankAccount"]) {
    if (update[key] !== undefined && String(update[key]).length > 256) {
      throw new ValidationError(`${key} is too long.`, { field: key });
    }
  }
}

/** Masks a bank account number for display (only the last 4 digits shown). */
function maskBankAccount(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return "****";
  return `****${str.slice(-4)}`;
}

module.exports = {
  SELF_SERVICE_FIELDS,
  HR_MANAGED_FIELDS,
  isSelfServiceField,
  assertEditableFields,
  validateProfileUpdate,
  maskBankAccount,
};
