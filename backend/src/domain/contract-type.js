/**
 * Contract-type domain model (NEW UPDATE TAD SIMBIKA).
 *
 * Master data for employee contract types. Statuses: ACTIVE (selectable on
 * user forms) and INACTIVE (deactivated, history preserved). No PENDING flow.
 */

const { ValidationError } = require("./errors");

const CONTRACT_TYPE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

/** Validates contract-type configuration input. */
function validateContractTypeInput({ key, name } = {}) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(String(key))) {
    throw new ValidationError(
      "Contract type key must be uppercase with letters, digits and underscores.",
      { field: "key" }
    );
  }
  if (!name || String(name).trim().length < 2) {
    throw new ValidationError("Contract type name is required.", { field: "name" });
  }
}

/** True when a contract type is usable on user forms. */
function isActiveContractType(entity) {
  return entity?.status === CONTRACT_TYPE_STATUS.ACTIVE;
}

module.exports = {
  CONTRACT_TYPE_STATUS,
  validateContractTypeInput,
  isActiveContractType,
};
