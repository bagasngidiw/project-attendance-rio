/**
 * Approval routing domain model (FR-042 / FR-063).
 *
 * Routing is configuration-driven: per request type a rule defines the chain
 * of levels, the fallback when a primary approver is unavailable, and whether
 * the rule is active. Level sources are resolved in order; the result is the
 * ordered approval chain plus the current step.
 *
 * FR-063 (unified single-approver workflow): every rule MUST resolve to
 * exactly ONE level. Sequential multi-level chains are no longer supported.
 *
 * Pure: source resolution and chain ordering are free of I/O. The application
 * layer supplies resolved approver ids (e.g. the requester's manager) via an
 * injected resolver function.
 */

const { ValidationError } = require("./errors");
const { assertSingleApprover } = require("./approval-policy");

/** Level source: the requester's direct manager (reporting line, FR-043). */
const SOURCE_MANAGER_OF_REQUESTER = "MANAGER_OF_REQUESTER";

/** Fallback targets when the primary approver is unavailable. */
const FALLBACK_ACTIVE_HR_ADMIN = "ACTIVE_HR_ADMIN";
const FALLBACK_SUPER_ADMIN = "SUPER_ADMIN";

const REQUEST_TYPES = Object.freeze(["LEAVE", "OVERTIME", "TRIP", "PERMISSION", "SAKIT"]);

/**
 * Default rule per request type (design §3.2): single-level via the
 * requester's manager, falling back to the first ACTIVE HR admin.
 */
const DEFAULT_ROUTING_RULE = Object.freeze({
  requestType: null, // filled per type
  levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }],
  fallback: FALLBACK_ACTIVE_HR_ADMIN,
  enabled: true,
});

/** Defaults for every request type (single-level, enabled). */
function defaultRules() {
  return Object.fromEntries(
    REQUEST_TYPES.map((type) => [
      type,
      {
        requestType: type,
        levels: [{ source: SOURCE_MANAGER_OF_REQUESTER }],
        fallback: FALLBACK_ACTIVE_HR_ADMIN,
        enabled: true,
      },
    ])
  );
}

/**
 * Structurally validates a routing rule (FR-042 config surface).
 *
 * @param {{ requestType: string, levels: Array<{ source: string }>, fallback: string, enabled: boolean }} rule
 * @returns normalized rule
 */
function validateRoutingRule(rule) {
  if (!REQUEST_TYPES.includes(rule.requestType)) {
    throw new ValidationError(
      `requestType must be one of ${REQUEST_TYPES.join(", ")}.`,
      { field: "requestType" }
    );
  }
  if (!Array.isArray(rule.levels) || rule.levels.length === 0) {
    throw new ValidationError("At least one routing level is required.", {
      field: "levels",
    });
  }
  // FR-063: the unified workflow is strictly single-approver.
  assertSingleApprover(rule);
  for (const level of rule.levels) {
    if (level.source !== SOURCE_MANAGER_OF_REQUESTER) {
      throw new ValidationError(
        `Unsupported level source "${level.source}".`,
        { field: "levels" }
      );
    }
  }
  if (
    rule.fallback !== FALLBACK_ACTIVE_HR_ADMIN &&
    rule.fallback !== FALLBACK_SUPER_ADMIN
  ) {
    throw new ValidationError("Unsupported fallback target.", {
      field: "fallback",
    });
  }
  return {
    requestType: rule.requestType,
    levels: rule.levels.map((level) => ({ source: level.source })),
    fallback: rule.fallback,
    enabled: rule.enabled !== false,
  };
}

/**
 * Evaluates a rule into an ordered approval chain. The `resolver` maps a
 * level source to an approver user id (or null). Missing approvers are
 * skipped; when the chain would be empty the fallback id is used.
 *
 * @param {object} rule validated routing rule
 * @param {(source: string, levelIndex: number) => Promise<string|null>} resolver
 * @param {string|null} fallbackId resolved fallback approver id
 * @returns {Promise<string[]>} ordered approver chain
 */
async function evaluateChain(rule, resolver, fallbackId) {
  const chain = [];
  for (let i = 0; i < rule.levels.length; i += 1) {
    const approverId = await resolver(rule.levels[i].source, i);
    if (approverId) chain.push(String(approverId));
  }
  if (chain.length === 0 && fallbackId) chain.push(String(fallbackId));
  return chain;
}

/**
 * True when a chain has more levels after the current step.
 *
 * DEPRECATED (FR-063): the unified workflow is strictly single-approver, so
 * this always returns false for any chain of length 1. Retained only so older
 * call sites continue to resolve without modification; multi-level chaining
 * is no longer reachable through validated routing rules.
 */
function hasMoreLevels(chain, step) {
  return Array.isArray(chain) && step < chain.length - 1;
}

module.exports = {
  SOURCE_MANAGER_OF_REQUESTER,
  FALLBACK_ACTIVE_HR_ADMIN,
  FALLBACK_SUPER_ADMIN,
  REQUEST_TYPES,
  DEFAULT_ROUTING_RULE,
  defaultRules,
  validateRoutingRule,
  evaluateChain,
  hasMoreLevels,
};
