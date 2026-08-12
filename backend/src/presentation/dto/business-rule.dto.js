/**
 * Business rule DTOs (FR-046). A rule update is a flat map of numeric values;
 * per-field types and ranges are enforced by the domain validators
 * (validateOvertimeRules / validateTripRules).
 */

const { z } = require("zod");

const businessRuleUpdateDto = z.record(z.string(), z.number());

module.exports = { businessRuleUpdateDto };
