/**
 * Approval policy domain model (FR-063).
 *
 * Enforces the strict single-approver invariant, evaluates cutoff/calendar
 * blocks, and governs escalation eligibility. Pure — no I/O; the application
 * layer supplies cutoff rules and calendar lookups.
 */

const { ValidationError } = require("./errors");

const APPROVAL_REQUEST_TYPES = Object.freeze(["LEAVE", "TRIP", "OVERTIME", "PERMISSION", "SAKIT"]);

/**
 * Default escalation policy (per request type). `escalationRateLimit` caps
 * how often a single requester may escalate the same request.
 */
const DEFAULT_ESCALATION_POLICY = Object.freeze({
  allowEscalation: true,
  escalationRateLimit: { max: 3, windowMs: 24 * 60 * 60 * 1000 },
});

/**
 * Enforces the single-approver invariant (U.1.1): a routing rule must resolve
 * to exactly one approval level. Sequential multi-level chains are forbidden.
 *
 * @param {{ levels: Array<unknown> }} rule
 * @throws {ValidationError} when levels.length !== 1
 */
function assertSingleApprover(rule) {
  if (!Array.isArray(rule.levels) || rule.levels.length !== 1) {
    throw new ValidationError(
      "The unified approval workflow requires exactly one approval level per rule.",
      { field: "levels" }
    );
  }
  return rule;
}

/**
 * Normalizes a cutoff rule (U.3). Weekdays are 0=Sunday..6=Saturday.
 * An empty/undefined `days` array means "allowed any weekday".
 *
 * @param {object} raw
 * @returns {object} normalized cutoff rule
 */
function normalizeCutoffRule(raw = {}) {
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number))].filter(
        (d) => Number.isInteger(d) && d >= 0 && d <= 6
      )
    : [];
  const fromTime = typeof raw.fromTime === "string" ? raw.fromTime : "";
  const toTime = typeof raw.toTime === "string" ? raw.toTime : "";
  return {
    requestType: raw.requestType ?? "*",
    days,
    fromTime,
    toTime,
    timezone: typeof raw.timezone === "string" ? raw.timezone : "",
    dependsOn: raw.dependsOn ?? "",
    enabled: raw.enabled !== false,
  };
}

/**
 * Evaluates whether an approval is currently blocked by a cutoff rule and/or
 * the business calendar.
 *
 * @param {object} request request document (type, submittedAt)
 * @param {Date|string} now current instant
 * @param {object} cutoffRule normalized cutoff rule (matching request type or "*")
 * @param {{ isWorkingDay?: (date: Date) => boolean }} calendar optional calendar adapter
 * @returns {{ blocked: boolean, reason?: string }}
 */
function isApprovalBlocked(request, now, cutoffRule, calendar = {}) {
  if (!cutoffRule || cutoffRule.enabled === false) {
    return { blocked: false };
  }

  const current = now instanceof Date ? now : new Date(now);
  const day = current.getDay(); // 0 = Sunday

  if (Array.isArray(cutoffRule.days) && cutoffRule.days.length > 0) {
    if (!cutoffRule.days.includes(day)) {
      return {
        blocked: true,
        reason: "Approval is only available on the configured cutoff weekdays.",
      };
    }
  }

  const withinTimeWindow = isWithinTimeWindow(current, cutoffRule.fromTime, cutoffRule.toTime);
  if (!withinTimeWindow.ok) {
    return { blocked: true, reason: withinTimeWindow.reason };
  }

  if (typeof calendar.isWorkingDay === "function" && !calendar.isWorkingDay(current)) {
    return { blocked: true, reason: "Today is not a working day on the company calendar." };
  }

  return { blocked: false };
}

/** Checks the local clock against [fromTime, toTime] (HH:mm, 24h). */
function isWithinTimeWindow(date, fromTime, toTime) {
  if (!fromTime && !toTime) return { ok: true };
  const minutes = date.getHours() * 60 + date.getMinutes();
  const parse = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
  };
  const from = parse(fromTime);
  const to = parse(toTime);
  if (from === null || to === null) return { ok: true };
  if (from <= to) {
    if (minutes < from || minutes > to) {
      return { ok: false, reason: `Approval is only available between ${fromTime} and ${toTime}.` };
    }
  } else {
    // Overnight window (e.g. 22:00 → 06:00).
    if (minutes < from && minutes > to) {
      return { ok: false, reason: `Approval is only available between ${fromTime} and ${toTime}.` };
    }
  }
  return { ok: true };
}

/**
 * Escalation eligibility (U.1.5): only PENDING requests may be escalated.
 * Rate limiting is applied by the application layer.
 *
 * @param {object} request
 * @param {object} policy normalized escalation policy
 * @returns {{ canEscalate: boolean, reason?: string }}
 */
function canEscalate(request, policy = DEFAULT_ESCALATION_POLICY) {
  if (policy.allowEscalation === false) {
    return { canEscalate: false, reason: "Escalation is disabled." };
  }
  if (!request || request.status !== "PENDING") {
    return { canEscalate: false, reason: "Only pending requests can be escalated." };
  }
  return { canEscalate: true };
}

/**
 * Validates a rejection/decision comment under FR-063 U.1.7: the field is
 * always shown, always optional, stored as-is (blank when empty), and the
 * display layer renders "No reason provided" for blank values.
 *
 * @param {string|null|undefined} comment
 * @returns {string} trimmed comment (possibly "")
 */
function normalizeDecisionComment(comment) {
  return typeof comment === "string" ? comment.trim() : "";
}

module.exports = {
  APPROVAL_REQUEST_TYPES,
  DEFAULT_ESCALATION_POLICY,
  assertSingleApprover,
  normalizeCutoffRule,
  isApprovalBlocked,
  isWithinTimeWindow,
  canEscalate,
  normalizeDecisionComment,
};
