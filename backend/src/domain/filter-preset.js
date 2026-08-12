/**
 * Filter preset domain model (FR-047).
 *
 * A filter preset is an owner-scoped, saved copy of a report/list filter set.
 * Validation is pure: a human-readable name, a whitelisted route, and a
 * filters object whose JSON serialization must stay within 64 KB. The
 * enforcement layer (application) guarantees ownership scoping on read /
 * update / delete; this module only checks shape and size.
 */

const { ValidationError } = require("./errors");

/** Routes a preset may be attached to (matching the report/list surfaces). */
const FILTER_PRESET_ROUTES = Object.freeze([
  "reports",
  "attendance",
  "users",
  "requests",
  "overtime",
  "audit",
]);

const MAX_FILTER_PRESET_NAME = 100;
const MAX_FILTER_PRESET_ROUTE = 64;
const MAX_FILTERS_BYTES = 64 * 1024; // 64 KB

function assertValidName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("A preset name is required.", { field: "name" });
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_FILTER_PRESET_NAME) {
    throw new ValidationError(
      `The preset name must be at most ${MAX_FILTER_PRESET_NAME} characters.`,
      { field: "name" }
    );
  }
  return trimmed;
}

function assertValidRoute(route) {
  if (typeof route !== "string" || !route.trim()) {
    throw new ValidationError("A route is required.", { field: "route" });
  }
  const trimmed = route.trim();
  if (trimmed.length > MAX_FILTER_PRESET_ROUTE) {
    throw new ValidationError(
      `The route must be at most ${MAX_FILTER_PRESET_ROUTE} characters.`,
      { field: "route" }
    );
  }
  if (!FILTER_PRESET_ROUTES.includes(trimmed)) {
    throw new ValidationError(
      `Unsupported route "${trimmed}". Allowed: ${FILTER_PRESET_ROUTES.join(", ")}.`,
      { field: "route" }
    );
  }
  return trimmed;
}

function assertValidFilters(filters) {
  if (
    typeof filters !== "object" ||
    filters === null ||
    Array.isArray(filters)
  ) {
    throw new ValidationError("Filters must be a plain object.", {
      field: "filters",
    });
  }
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(filters));
  } catch (err) {
    throw new ValidationError("Filters must be JSON-serializable.", {
      field: "filters",
    });
  }
  if (bytes > MAX_FILTERS_BYTES) {
    throw new ValidationError(
      `Filters exceed the ${MAX_FILTERS_BYTES / 1024} KB limit.`,
      { field: "filters" }
    );
  }
  return filters;
}

/**
 * Validates a filter preset input and returns a normalized copy.
 *
 * @param {{ name: string, route: string, filters: object }} input
 * @returns {{ name: string, route: string, filters: object }}
 */
function validateFilterPreset(input = {}) {
  return {
    name: assertValidName(input.name),
    route: assertValidRoute(input.route),
    filters: assertValidFilters(input.filters),
  };
}

module.exports = {
  FILTER_PRESET_ROUTES,
  MAX_FILTER_PRESET_NAME,
  MAX_FILTER_PRESET_ROUTE,
  MAX_FILTERS_BYTES,
  validateFilterPreset,
};
