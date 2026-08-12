/**
 * Leave balance domain model (FR-022).
 *
 * A balance per user / leave type / year is derived from four counters:
 *
 *   available = entitlement + adjustment - consumed - reserved
 *
 * Entitlement and adjustment are granted by HR; consumption is recorded when
 * approved leave is taken; reservations hold business days against pending
 * requests so employees cannot over-book while approvals are in flight.
 */

const { ValidationError } = require("./errors");

const MIN_BALANCE_YEAR = 2000;

function toFinite(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Computes the available balance from its counters.
 *
 * @param {{ entitlementDays?: number, adjustmentDays?: number, consumedDays?: number, reservedDays?: number }} input
 * @returns {number}
 */
function computeBalance({ entitlementDays, adjustmentDays, consumedDays, reservedDays } = {}) {
  return (
    toFinite(entitlementDays) +
    toFinite(adjustmentDays) -
    toFinite(consumedDays) -
    toFinite(reservedDays)
  );
}

/**
 * Validates (and normalizes) a balance year.
 *
 * @param {number} year
 * @returns {number}
 */
function assertYear(year, { field = "year" } = {}) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < MIN_BALANCE_YEAR) {
    throw new ValidationError(
      `year must be an integer of ${MIN_BALANCE_YEAR} or later.`,
      { field }
    );
  }
  return value;
}

/**
 * Validates an HR balance adjustment.
 *
 * @param {{ deltaDays: number, reason: string, year: number }} input
 */
function validateAdjustment({ deltaDays, reason, year } = {}) {
  if (typeof deltaDays !== "number" || !Number.isFinite(deltaDays) || deltaDays === 0) {
    throw new ValidationError("deltaDays must be a non-zero number.", {
      field: "deltaDays",
    });
  }
  if (!reason || !String(reason).trim()) {
    throw new ValidationError("A reason is required.", { field: "reason" });
  }
  assertYear(year);
}

/**
 * Evaluates whether a requested number of days fits within the available
 * balance.
 *
 * @param {{ balance?: number, requestedDays?: number }} input
 * @returns {{ balance: number, requestedDays: number, canSubmit: boolean, wouldExceedBalance: boolean }}
 */
function canSubmit({ balance, requestedDays } = {}) {
  const available = toFinite(balance);
  const days = toFinite(requestedDays);
  return {
    balance: available,
    requestedDays: days,
    canSubmit: available >= days,
    wouldExceedBalance: available < days,
  };
}

module.exports = {
  MIN_BALANCE_YEAR,
  computeBalance,
  assertYear,
  validateAdjustment,
  canSubmit,
};
