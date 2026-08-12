/**
 * Placement domain model (NEW UPDATE TAD SIMBIKA).
 *
 * Master data for employee placements. Statuses: ACTIVE (selectable on user
 * forms) and INACTIVE (deactivated, history preserved). No PENDING flow.
 */

const { ValidationError } = require("./errors");

const PLACEMENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

/** Validates placement configuration input. */
function validatePlacementInput({ key, name } = {}) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(String(key))) {
    throw new ValidationError(
      "Placement key must be uppercase with letters, digits and underscores.",
      { field: "key" }
    );
  }
  if (!name || String(name).trim().length < 2) {
    throw new ValidationError("Placement name is required.", { field: "name" });
  }
}

/** True when a placement is usable on user forms. */
function isActivePlacement(entity) {
  return entity?.status === PLACEMENT_STATUS.ACTIVE;
}

module.exports = {
  PLACEMENT_STATUS,
  validatePlacementInput,
  isActivePlacement,
};
