/**
 * Sickness-type domain model (TODO.md §5).
 *
 * Sakit has its own master data, independent from Leave types. Statuses:
 * ACTIVE (usable on the submission form), INACTIVE (deactivated), and PENDING
 * (user-suggested via "Tambahkan sendiri" — an administrator activates it).
 */

const { ValidationError } = require("./errors");

const SICKNESS_TYPE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING: "PENDING",
});

/** System defaults seeded so the sickness form works out of the box. */
const SYSTEM_SICKNESS_TYPES = Object.freeze([
  { key: "UMUM", name: "Sakit Umum", isSystem: true },
  { key: "DEMAM", name: "Demam", isSystem: true },
  { key: "FLU", name: "Flu", isSystem: true },
  { key: "RAWAT_JALAN", name: "Rawat Jalan", isSystem: true },
  { key: "RAWAT_INAP", name: "Rawat Inap", isSystem: true },
]);

/** Validates sickness-type configuration input. */
function validateSicknessTypeInput({ key, name } = {}) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(String(key))) {
    throw new ValidationError(
      "Sickness type key must be uppercase with letters, digits and underscores.",
      { field: "key" }
    );
  }
  if (!name || String(name).trim().length < 2) {
    throw new ValidationError("Sickness type name is required.", { field: "name" });
  }
}

/** True when a sickness type is usable on the submission form. */
function isActiveSicknessType(entity) {
  return entity?.status === SICKNESS_TYPE_STATUS.ACTIVE;
}

module.exports = {
  SICKNESS_TYPE_STATUS,
  SYSTEM_SICKNESS_TYPES,
  validateSicknessTypeInput,
  isActiveSicknessType,
};
