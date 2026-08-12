/**
 * ExceptionReviewService tests (FR-053): the team exception list is strictly
 * scoped to the manager's direct reports, out-of-scope reviews answer 404,
 * reviews append history, and the ATTENDANCE.EXCEPTION_REVIEWED audit event
 * is recorded.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { ExceptionReviewService } = require("../../src/application/exception-review.service");
const { NotFoundError } = require("../../src/domain/errors");

/** In-memory port for the exception-review repository. */
class InMemoryExceptionReviewRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create(data) {
    const entry = {
      id: `review_${this.nextId++}`,
      attendanceId: data.attendanceId,
      userId: data.userId,
      reviewerId: data.reviewerId,
      outcome: data.outcome,
      comment: data.comment ?? "",
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findByAttendanceId(attendanceId) {
    return this.entries
      .filter((e) => String(e.attendanceId) === String(attendanceId))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async listByReviewer(reviewerId) {
    return this.entries.filter((e) => String(e.reviewerId) === String(reviewerId));
  }

  async listByUser(userId) {
    return this.entries.filter((e) => String(e.userId) === String(userId));
  }
}

function makeService(overrides = {}) {
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
  const exceptionReviewRepository = new InMemoryExceptionReviewRepository();
  const service = new ExceptionReviewService({
    userRepository: fakes.userRepository,
    attendanceRepository: fakes.attendanceRepository,
    exceptionReviewRepository,
    auditService,
    ...overrides,
  });
  return { service, fakes, auditService, exceptionReviewRepository };
}

function seedUser(fakes, { id, name = id, departmentId = null, managerId = null }) {
  fakes.userRepository.seed({
    id,
    username: id,
    email: `${id}@corp.io`,
    name,
    status: "ACTIVE",
    departmentId,
    managerId,
  });
  return id;
}

function seedAttendance(fakes, { userId, date, exceptionTypes = [], status = "NORMAL" }) {
  return fakes.attendanceRepository.create({
    userId,
    date,
    clockInAt: new Date(`${date}T08:00:00.000Z`),
    source: "SELF",
    exceptionTypes,
    status,
  });
}

test("listTeamExceptions shows only direct reports' exception records (FR-053)", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_emp1", managerId: "u_mgr" });
  seedUser(fakes, { id: "u_emp2" }); // not a direct report

  await seedAttendance(fakes, {
    userId: "u_emp1",
    date: "2026-08-01",
    exceptionTypes: ["MISSING_CLOCK_OUT"],
    status: "EXCEPTION",
  });
  await seedAttendance(fakes, { userId: "u_emp1", date: "2026-08-02" }); // normal
  await seedAttendance(fakes, {
    userId: "u_emp2",
    date: "2026-08-01",
    exceptionTypes: ["ANOMALY"],
    status: "EXCEPTION",
  });

  const result = await service.listTeamExceptions({ managerId: "u_mgr" });

  assert.equal(result.total, 1, "only u_emp1's exception record is surfaced");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].userId, "u_emp1");
  assert.deepEqual(result.items[0].exceptionTypes, ["MISSING_CLOCK_OUT"]);
  assert.equal(result.items[0].user.name, "u_emp1");
  assert.deepEqual(result.items[0].reviews, []);
  assert.equal(result.items[0].latestReview, null);
});

test("listTeamExceptions supports date range and status filters", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_emp1", managerId: "u_mgr" });

  await seedAttendance(fakes, {
    userId: "u_emp1",
    date: "2026-08-01",
    exceptionTypes: ["ANOMALY"],
    status: "EXCEPTION",
  });
  await seedAttendance(fakes, {
    userId: "u_emp1",
    date: "2026-08-05",
    exceptionTypes: ["MISSING_CLOCK_OUT"],
    status: "EXCEPTION",
  });

  const ranged = await service.listTeamExceptions({
    managerId: "u_mgr",
    from: "2026-08-01",
    to: "2026-08-02",
  });
  assert.equal(ranged.total, 1);
  assert.equal(ranged.items[0].date, "2026-08-01");

  const normalStatus = await service.listTeamExceptions({
    managerId: "u_mgr",
    status: "NORMAL",
  });
  assert.equal(
    normalStatus.total,
    0,
    "records without exceptions are never surfaced"
  );

  const all = await service.listTeamExceptions({ managerId: "u_mgr" });
  assert.equal(all.total, 2);
});

test("a manager with no direct reports sees an empty list", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_other", managerId: "u_someone" });

  const result = await service.listTeamExceptions({ managerId: "u_mgr" });
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
});

test("recordReview appends a review and audits for a direct report's exception (FR-053)", async () => {
  const { service, fakes, exceptionReviewRepository } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_emp1", managerId: "u_mgr" });
  const record = await seedAttendance(fakes, {
    userId: "u_emp1",
    date: "2026-08-01",
    exceptionTypes: ["MISSING_CLOCK_OUT"],
    status: "EXCEPTION",
  });

  const actor = {
    actorId: "u_mgr",
    actorRoleKeys: ["MANAGER"],
    ip: "10.0.0.1",
    userAgent: "test-agent",
    correlationId: "c1",
  };

  const review = await service.recordReview(
    {
      attendanceId: record.id,
      reviewerId: "u_mgr",
      outcome: "FLAGGED_HR",
      comment: "Escalating for HR review.",
    },
    actor
  );

  assert.equal(review.outcome, "FLAGGED_HR");
  assert.equal(review.comment, "Escalating for HR review.");
  assert.equal(review.userId, "u_emp1");
  assert.equal(review.reviewerId, "u_mgr");
  assert.equal(exceptionReviewRepository.entries.length, 1);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "ATTENDANCE.EXCEPTION_REVIEWED"
  );
  assert.ok(audit, "review is audited");
  assert.equal(audit.metadata.attendanceId, record.id);
  assert.equal(audit.metadata.outcome, "FLAGGED_HR");
  assert.equal(audit.actor.userId, "u_mgr");

  // Append-only: a second review preserves the first.
  const second = await service.recordReview(
    { attendanceId: record.id, reviewerId: "u_mgr", outcome: "CONFIRMED" },
    actor
  );
  assert.equal(second.outcome, "CONFIRMED");
  assert.equal(second.comment, "");
  assert.equal(exceptionReviewRepository.entries.length, 2);

  const attached = await service.listTeamExceptions({ managerId: "u_mgr" });
  assert.equal(attached.items[0].reviews.length, 2);
  assert.equal(attached.items[0].latestReview.outcome, "CONFIRMED");
});

test("recordReview answers 404 for a non-direct-report's exception", async () => {
  const { service, fakes, exceptionReviewRepository } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_emp2" });
  const record = await seedAttendance(fakes, {
    userId: "u_emp2",
    date: "2026-08-01",
    exceptionTypes: ["ANOMALY"],
    status: "EXCEPTION",
  });

  await assert.rejects(
    service.recordReview(
      { attendanceId: record.id, reviewerId: "u_mgr", outcome: "CONFIRMED" },
      { actorId: "u_mgr" }
    ),
    (err) => err instanceof NotFoundError && err.code === "ATTENDANCE_NOT_FOUND"
  );
  assert.equal(exceptionReviewRepository.entries.length, 0);
  assert.ok(
    !fakes.auditRepository.entries.some(
      (e) => e.action === "ATTENDANCE.EXCEPTION_REVIEWED"
    )
  );
});

test("recordReview answers 404 for a missing attendance record", async () => {
  const { service, fakes, exceptionReviewRepository } = makeService();
  seedUser(fakes, { id: "u_mgr" });

  await assert.rejects(
    service.recordReview(
      { attendanceId: "att_missing", reviewerId: "u_mgr", outcome: "CONFIRMED" },
      { actorId: "u_mgr" }
    ),
    NotFoundError
  );
  assert.equal(exceptionReviewRepository.entries.length, 0);
});

test("recordReview answers 404 when the attendance record has no exceptions", async () => {
  const { service, fakes, exceptionReviewRepository } = makeService();
  seedUser(fakes, { id: "u_mgr" });
  seedUser(fakes, { id: "u_emp1", managerId: "u_mgr" });
  const record = await seedAttendance(fakes, { userId: "u_emp1", date: "2026-08-01" });

  await assert.rejects(
    service.recordReview(
      { attendanceId: record.id, reviewerId: "u_mgr", outcome: "CONFIRMED" },
      { actorId: "u_mgr" }
    ),
    NotFoundError
  );
  assert.equal(exceptionReviewRepository.entries.length, 0);
});
