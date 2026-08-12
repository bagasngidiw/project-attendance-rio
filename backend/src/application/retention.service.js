/**
 * RetentionService (FR-040) — data retention policy + sweep.
 *
 * The policy is stored as the `retentionPolicy` platform setting; every change
 * is recorded as RETENTION.POLICY_CHANGED. The sweep counts and (where the
 * underlying repository exposes the deletion seam) physically removes expired
 * records per category, honouring legal holds, then records RETENTION.SWEEP_RAN
 * and a retention-job document.
 *
 * v1 scope: audit events, activity logs, and attachments may be physically
 * deleted. Requests and users are active business data and are NEVER deleted —
 * they are only counted as an archive marker for a future tier.
 */

const {
  RETENTION_CATEGORIES,
  DAY_MS,
  normalizeRetentionPolicy,
} = require("../domain/retention");

const RETENTION_SETTING_KEY = "retentionPolicy";

/** Categories eligible for physical deletion in v1. */
const SWEEP_DELETABLE_CATEGORIES = Object.freeze([
  "auditEventsDays",
  "activityLogsDays",
  "attachmentsDays",
]);

/** Repository port name for each retention category. */
const CATEGORY_REPOS = Object.freeze({
  auditEventsDays: "auditRepository",
  activityLogsDays: "activityRepository",
  attachmentsDays: "attachmentRepository",
  requestsDays: "requestRepository",
  usersDays: "userRepository",
});

/** Legal-hold reference types that protect each category. */
const CATEGORY_LEGAL_HOLD_TYPES = Object.freeze({
  auditEventsDays: ["USER"],
  activityLogsDays: ["USER"],
  attachmentsDays: ["USER", "REQUEST", "ATTACHMENT"],
  requestsDays: ["USER", "REQUEST"],
  usersDays: ["USER"],
});

class RetentionService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {object} deps.jobRepository retention-job port (create/markCompleted/markFailed/latest)
   * @param {object} deps.auditRepository physical audit-events store (count/delete seam)
   * @param {object} deps.activityRepository physical activity-log store (count/delete seam)
   * @param {object|null} deps.attachmentRepository attachments store (may be null in v1)
   * @param {object} deps.requestRepository requests store (count-only, never deleted)
   * @param {object} deps.userRepository users store (count-only, never deleted)
   * @param {object} [deps.config] optional configuration; config.clock() provides the sweep time
   */
  constructor({
    platformSettingRepository,
    auditService,
    jobRepository,
    auditRepository,
    activityRepository,
    attachmentRepository = null,
    requestRepository,
    userRepository,
    config = {},
  }) {
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
    this.jobRepository = jobRepository;
    this.repos = {
      auditRepository,
      activityRepository,
      attachmentRepository,
      requestRepository,
      userRepository,
    };
    this.config = config;
  }

  /** Returns the stored policy normalized over the defaults. */
  async getPolicy() {
    const stored = await this.platformSettingRepository.get(RETENTION_SETTING_KEY);
    return normalizeRetentionPolicy(stored);
  }

  /**
   * Validates + persists a new policy and audits the change.
   *
   * @param {object} policy
   * @param {object} actor { actorId, actorRoleKeys, ip, userAgent, correlationId }
   */
  async setPolicy(policy, actor = {}) {
    const normalized = normalizeRetentionPolicy(policy);
    const oldValue = await this.platformSettingRepository.get(RETENTION_SETTING_KEY);
    await this.platformSettingRepository.set(
      RETENTION_SETTING_KEY,
      normalized,
      actor.actorId ?? null
    );

    await this.auditService.record({
      action: "RETENTION.POLICY_CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: RETENTION_SETTING_KEY, summary: RETENTION_SETTING_KEY },
      outcome: "SUCCESS",
      metadata: { setting: RETENTION_SETTING_KEY, oldValue: oldValue ?? null, newValue: normalized },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { key: RETENTION_SETTING_KEY, value: normalized };
  }

  /**
   * Runs one sweep pass over every retention category.
   *
   * @param {object} input
   * @param {string|null} input.triggeredBy user id of the actor triggering the sweep
   * @param {Date|string} [input.now] injectable clock (defaults to now / config.clock)
   * @returns {Promise<{ job: object, summary: object }>}
   */
  async runSweep({ triggeredBy = null, now } = {}) {
    const policy = normalizeRetentionPolicy(
      await this.platformSettingRepository.get(RETENTION_SETTING_KEY)
    );
    const startedAt = this.resolveSweepTime(now);
    const job = await this.jobRepository.create({ jobType: "SWEEP", triggeredBy });

    const perCategory = {};
    try {
      for (const category of RETENTION_CATEGORIES) {
        const retentionDays = policy[category];
        if (retentionDays === null || retentionDays === undefined) {
          perCategory[category] = { count: null, deleted: 0, skipped: true };
          continue;
        }
        const cutoff = new Date(startedAt.getTime() - retentionDays * DAY_MS);
        const exceptIds = this.legalHoldIdsFor(policy, category);
        const repo = this.repos[CATEGORY_REPOS[category]];
        const { count } = await this.countOlderThan(repo, cutoff, exceptIds);
        const { deleted } = await this.deleteOlderThan(repo, category, cutoff, exceptIds);
        perCategory[category] = { count, deleted };
      }

      const summary = { perCategory };
      await this.jobRepository.markCompleted(job.id, summary);
      await this.auditService.record({
        action: "RETENTION.SWEEP_RAN",
        actor: { userId: triggeredBy ?? null, roleKeys: [] },
        subject: { type: "RETENTION_JOB", id: job.id, summary: "retention sweep" },
        outcome: "SUCCESS",
        metadata: { perCategory },
      });
      return { job, summary };
    } catch (err) {
      await this.jobRepository.markFailed(job.id, err);
      throw err;
    }
  }

  /** Resolves the sweep clock: explicit `now` > config.clock > Date.now. */
  resolveSweepTime(now) {
    if (now !== undefined) return new Date(now);
    if (typeof this.config?.clock === "function") return new Date(this.config.clock());
    return new Date();
  }

  /** Legal-hold ids that shield a category from the sweep. */
  legalHoldIdsFor(policy, category) {
    const allowed = new Set(CATEGORY_LEGAL_HOLD_TYPES[category] ?? []);
    return (policy.legalHold ?? [])
      .filter((ref) => allowed.has(ref.type))
      .map((ref) => ref.id);
  }

  /**
   * Counts records older than the cutoff not on legal hold.
   *
   * Documented seam: the repository exposes `countOlderThan(cutoff, { exceptIds })`
   * to report how many records fall outside the retention window. Until a category
   * implements it, the sweep reports count: null (no count is computed).
   */
  async countOlderThan(repo, cutoff, exceptIds) {
    if (!repo || typeof repo.countOlderThan !== "function") {
      return { count: null };
    }
    return { count: await repo.countOlderThan(cutoff, { exceptIds }) };
  }

  /**
   * Physically deletes expired records when the repository exposes the deletion
   * seam `deleteOlderThan(cutoff, { exceptIds })`. Requests and users are never
   * deleted in v1 — they are only counted/archived.
   */
  async deleteOlderThan(repo, category, cutoff, exceptIds) {
    if (!repo || typeof repo.deleteOlderThan !== "function") {
      return { deleted: 0 };
    }
    if (!SWEEP_DELETABLE_CATEGORIES.includes(category)) {
      return { deleted: 0 };
    }
    return { deleted: await repo.deleteOlderThan(cutoff, { exceptIds }) };
  }
}

module.exports = { RetentionService };
