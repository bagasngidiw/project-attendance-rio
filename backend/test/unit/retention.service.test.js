/**
 * RetentionService tests (FR-040): policy read/write + audit, and the sweep
 * counting/deletion pass with a documented seam + RETENTION.SWEEP_RAN audit.
 *
 * Uses buildFakes() for the shared fakes and small in-memory fakes for the
 * retention-job and physical-store repositories defined below.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { RetentionService } = require("../../src/application/retention.service");
const { ValidationError } = require("../../src/domain/errors");

class InMemoryRetentionJobRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create({ jobType, triggeredBy = null }) {
    const job = {
      id: `job_${this.nextId++}`,
      jobType,
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      summary: null,
      triggeredBy,
    };
    this.entries.push(job);
    return job;
  }

  async markCompleted(id, summary) {
    const job = this.entries.find((j) => j.id === id);
    if (job) {
      job.status = "COMPLETED";
      job.finishedAt = new Date();
      job.summary = summary;
    }
    return job;
  }

  async markFailed(id, error) {
    const job = this.entries.find((j) => j.id === id);
    if (job) {
      job.status = "FAILED";
      job.finishedAt = new Date();
      job.summary =
        error instanceof Error ? { error: error.message } : { error: String(error) };
    }
    return job;
  }

  async latest(jobType) {
    const matches = this.entries
      .filter((j) => j.jobType === jobType)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return matches[0] ?? null;
  }
}

class InMemorySweepableRepository {
  constructor({ entries = [] } = {}) {
    this.entries = entries; // { id, recordedAt, actorId }
  }

  async countOlderThan(cutoff, { exceptIds = [] } = {}) {
    const except = new Set(exceptIds.map(String));
    return this.entries.filter(
      (e) => new Date(e.recordedAt) < cutoff && !except.has(String(e.actorId))
    ).length;
  }

  async deleteOlderThan(cutoff, { exceptIds = [] } = {}) {
    const except = new Set(exceptIds.map(String));
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => !(new Date(e.recordedAt) < cutoff && !except.has(String(e.actorId)))
    );
    return before - this.entries.length;
  }
}

class InMemoryCountOnlyRepository {
  constructor({ entries = [] } = {}) {
    this.entries = entries;
  }

  async countOlderThan(cutoff, { exceptIds = [] } = {}) {
    const except = new Set(exceptIds.map(String));
    return this.entries.filter(
      (e) => new Date(e.recordedAt) < cutoff && !except.has(String(e.actorId))
    ).length;
  }
}

class ThrowingRepository {
  async countOlderThan() {
    throw new Error("boom");
  }
}

function makeService({ auditEntries = [], activityEntries = [], config = {} } = {}) {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const jobRepository = new InMemoryRetentionJobRepository();
  const auditRepository = new InMemorySweepableRepository({ entries: auditEntries });
  const activityRepository = new InMemorySweepableRepository({ entries: activityEntries });
  const service = new RetentionService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    jobRepository,
    auditRepository,
    activityRepository,
    attachmentRepository: null,
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
    config,
  });
  return { service, fakes, jobRepository, auditRepository, activityRepository };
}

function makeAuditService(fakes) {
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  return new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

test("getPolicy returns the default policy when none is stored", async () => {
  const { service } = makeService();
  const policy = await service.getPolicy();
  assert.equal(policy.auditEventsDays, 730);
  assert.equal(policy.usersDays, null);
  assert.deepEqual(policy.legalHold, []);
});

test("getPolicy returns the stored policy normalized", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("retentionPolicy", {
    auditEventsDays: 90,
    legalHold: [{ type: "USER", id: "u_9" }],
  });
  const policy = await service.getPolicy();
  assert.equal(policy.auditEventsDays, 90);
  assert.equal(policy.activityLogsDays, 365);
  assert.deepEqual(policy.legalHold, [{ type: "USER", id: "u_9" }]);
});

test("setPolicy validates, persists, and audits RETENTION.POLICY_CHANGED", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("retentionPolicy", {
    auditEventsDays: 365,
  });

  const result = await service.setPolicy({ auditEventsDays: 90 }, ACTOR);
  assert.equal(result.key, "retentionPolicy");
  assert.equal(result.value.auditEventsDays, 90);
  assert.equal(
    (await fakes.platformSettingRepository.get("retentionPolicy")).auditEventsDays,
    90
  );

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "RETENTION.POLICY_CHANGED"
  );
  assert.ok(audit, "RETENTION.POLICY_CHANGED recorded");
  assert.equal(audit.actor.userId, "u_admin");
  assert.equal(audit.metadata.setting, "retentionPolicy");
  assert.equal(audit.metadata.oldValue.auditEventsDays, 365);
  assert.equal(audit.metadata.newValue.auditEventsDays, 90);
});

test("setPolicy rejects invalid policies without persisting", async () => {
  const { service, fakes } = makeService();
  await assert.rejects(
    service.setPolicy({ auditEventsDays: -5 }, ACTOR),
    (err) => err instanceof ValidationError
  );
  await assert.rejects(
    service.setPolicy({ legalHold: "nope" }, ACTOR),
    (err) => err instanceof ValidationError
  );
  assert.equal(await fakes.platformSettingRepository.get("retentionPolicy"), null);
});

test("runSweep counts and deletes expired records, honours legal holds", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date("2010-01-01T00:00:00Z");
  const recent = new Date("2025-12-31T00:00:00Z");

  const auditEntries = [
    { id: "a1", recordedAt: old, actorId: "u_1" },
    { id: "a2", recordedAt: old, actorId: "u_2" },
    { id: "a3", recordedAt: old, actorId: "u_hold" },
    { id: "a4", recordedAt: recent, actorId: "u_3" },
  ];
  const activityEntries = [
    { id: "l1", recordedAt: old, actorId: "u_1" },
    { id: "l2", recordedAt: old, actorId: "u_2" },
  ];
  const { service, fakes, jobRepository, auditRepository, activityRepository } =
    makeService({ auditEntries, activityEntries });

  await fakes.platformSettingRepository.set("retentionPolicy", {
    auditEventsDays: 365,
    activityLogsDays: 365,
    attachmentsDays: 365,
    requestsDays: 365,
    usersDays: null,
    legalHold: [{ type: "USER", id: "u_hold" }],
  });

  const req = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_1",
    payload: {},
    status: "APPROVED",
  });
  req.submittedAt = old;
  fakes.requestRepository.countOlderThan = async function (cutoff, { exceptIds = [] } = {}) {
    return [...this.requests.values()].filter(
      (r) => r.submittedAt && new Date(r.submittedAt) < cutoff
    ).length;
  };

  const { job, summary } = await service.runSweep({ triggeredBy: "u_admin", now });

  assert.equal(job.status, "COMPLETED");
  assert.deepEqual(summary.perCategory.auditEventsDays, { count: 2, deleted: 2 });
  assert.deepEqual(summary.perCategory.activityLogsDays, { count: 2, deleted: 2 });
  assert.deepEqual(summary.perCategory.attachmentsDays, { count: null, deleted: 0 });
  assert.deepEqual(summary.perCategory.requestsDays, { count: 1, deleted: 0 });
  assert.deepEqual(summary.perCategory.usersDays, {
    count: null,
    deleted: 0,
    skipped: true,
  });

  assert.equal(auditRepository.entries.length, 2);
  assert.deepEqual(
    auditRepository.entries.map((e) => e.id).sort(),
    ["a3", "a4"]
  );
  assert.equal(activityRepository.entries.length, 0);

  const completed = jobRepository.entries.find((j) => j.id === job.id);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.triggeredBy, "u_admin");

  const sweep = fakes.auditRepository.entries.find((e) => e.action === "RETENTION.SWEEP_RAN");
  assert.ok(sweep, "RETENTION.SWEEP_RAN recorded");
  assert.equal(sweep.actor.userId, "u_admin");
  assert.deepEqual(sweep.metadata.perCategory.auditEventsDays, { count: 2, deleted: 2 });
});

test("runSweep falls back to count-only when the deletion seam is absent", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date("2010-01-01T00:00:00Z");

  const fakes = buildFakes();
  const auditService = makeAuditService(fakes);
  const jobRepository = new InMemoryRetentionJobRepository();
  const auditRepository = new InMemoryCountOnlyRepository({
    entries: [{ id: "a1", recordedAt: old, actorId: "u_1" }],
  });
  const activityRepository = new InMemoryCountOnlyRepository({
    entries: [{ id: "l1", recordedAt: old, actorId: "u_1" }],
  });
  const service = new RetentionService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    jobRepository,
    auditRepository,
    activityRepository,
    attachmentRepository: new InMemoryCountOnlyRepository({
      entries: [{ id: "f1", recordedAt: old, actorId: "u_1" }],
    }),
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
  });

  await fakes.platformSettingRepository.set("retentionPolicy", {
    auditEventsDays: 365,
    activityLogsDays: 365,
    attachmentsDays: 365,
    requestsDays: 365,
    usersDays: null,
  });

  const { job, summary } = await service.runSweep({ triggeredBy: "u_admin", now });

  assert.equal(summary.perCategory.auditEventsDays.count, 1);
  assert.equal(summary.perCategory.auditEventsDays.deleted, 0);
  assert.equal(summary.perCategory.activityLogsDays.count, 1);
  assert.equal(summary.perCategory.activityLogsDays.deleted, 0);
  assert.equal(summary.perCategory.attachmentsDays.count, 1);
  assert.equal(summary.perCategory.attachmentsDays.deleted, 0);
  assert.equal(summary.perCategory.requestsDays.count, null);
  assert.equal(summary.perCategory.usersDays.skipped, true);
  assert.equal(auditRepository.entries.length, 1);
  assert.equal(activityRepository.entries.length, 1);
  assert.equal(job.status, "COMPLETED");
});

test("requests are counted but never physically deleted in v1", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date("2010-01-01T00:00:00Z");
  const { service, fakes } = makeService();

  await fakes.platformSettingRepository.set("retentionPolicy", {
    auditEventsDays: 365,
    activityLogsDays: 365,
    attachmentsDays: 365,
    requestsDays: 365,
    usersDays: null,
  });

  const req = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_1",
    payload: {},
    status: "APPROVED",
  });
  req.submittedAt = old;
  fakes.requestRepository.countOlderThan = async function (cutoff, { exceptIds = [] } = {}) {
    return [...this.requests.values()].filter(
      (r) => r.submittedAt && new Date(r.submittedAt) < cutoff
    ).length;
  };
  fakes.requestRepository.deleteOlderThan = async () => 999;

  const { summary } = await service.runSweep({ triggeredBy: "u_admin", now });
  assert.equal(summary.perCategory.requestsDays.count, 1);
  assert.equal(summary.perCategory.requestsDays.deleted, 0);
  assert.equal(fakes.requestRepository.requests.size, 1);
});

test("runSweep marks the job FAILED when a category errors", async () => {
  const fakes = buildFakes();
  const auditService = makeAuditService(fakes);
  const jobRepository = new InMemoryRetentionJobRepository();
  const service = new RetentionService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    jobRepository,
    auditRepository: new ThrowingRepository(),
    activityRepository: new InMemorySweepableRepository({ entries: [] }),
    attachmentRepository: null,
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
  });

  await fakes.platformSettingRepository.set("retentionPolicy", { auditEventsDays: 365 });

  await assert.rejects(service.runSweep({ triggeredBy: "u_admin" }), /boom/);
  const failed = jobRepository.entries[0];
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.summary.error, "boom");
});

test("runSweep uses config.clock when no explicit now is supplied", async () => {
  const fixedNow = new Date("2026-06-01T00:00:00Z");
  const old = new Date("2010-01-01T00:00:00Z");
  const { service, fakes } = makeService({
    auditEntries: [{ id: "a1", recordedAt: old, actorId: "u_1" }],
    config: { clock: () => fixedNow },
  });
  await fakes.platformSettingRepository.set("retentionPolicy", { auditEventsDays: 365 });

  const { summary } = await service.runSweep({ triggeredBy: "u_admin" });
  assert.equal(summary.perCategory.auditEventsDays.count, 1);
  assert.equal(summary.perCategory.auditEventsDays.deleted, 1);
});
