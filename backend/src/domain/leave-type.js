/**
 * Leave-type domain model (FR-058).
 *
 * Leave types (Sick, Personal, Annual, ...) are configuration, not code: each
 * type defines rules (balance-based or not, max days per request, required
 * supporting info) and a lifecycle. The submission form loads ACTIVE types;
 * deactivation preserves history.
 */

const { ValidationError } = require("./errors");

const LEAVE_TYPE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  // TODO.md §6: user-suggested types await admin activation.
  PENDING: "PENDING",
});

/** System defaults seeded so the leave form works out of the box. */
const SYSTEM_LEAVE_TYPES = Object.freeze([
  { key: "SICK", name: "Sick Leave", isBalanceBased: false, isSystem: true },
  { key: "PERSONAL", name: "Personal Leave", isBalanceBased: false, isSystem: true },
  { key: "ANNUAL", name: "Annual Leave", isBalanceBased: true, isSystem: true },
]);

/** Validates leave-type configuration input. */
function validateLeaveTypeInput({ key, name, maxDaysPerRequest } = {}) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(String(key))) {
    throw new ValidationError(
      "Leave type key must be uppercase with letters, digits and underscores.",
      { field: "key" }
    );
  }
  if (!name || String(name).trim().length < 2) {
    throw new ValidationError("Leave type name is required.", { field: "name" });
  }
  if (
    maxDaysPerRequest !== undefined &&
    maxDaysPerRequest !== null &&
    (typeof maxDaysPerRequest !== "number" || maxDaysPerRequest <= 0)
  ) {
    throw new ValidationError("maxDaysPerRequest must be a positive number.", {
      field: "maxDaysPerRequest",
    });
  }
}

/** True when a leave type is active (usable on the submission form). */
function isActiveLeaveType(entity) {
  return entity?.status === LEAVE_TYPE_STATUS.ACTIVE;
}

module.exports = {
  LEAVE_TYPE_STATUS,
  SYSTEM_LEAVE_TYPES,
  validateLeaveTypeInput,
  isActiveLeaveType,
};
