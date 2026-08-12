/**
 * OvertimeAdminService tests (FR-055): overtime list filters (employee,
 * department, status, date range), scoped detail, append-only corrections
 * that never mutate the original request, the OVERTIME.CORRECTED audit event,
 * and missing-reason rejection.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { OvertimeAdminService } = require("../../src/application/overtime-admin.service");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

/** In-memory port for the overtime-correction repository. */
class InMemoryOvertimeCorrectionRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create(data) {
    const entry = {
      id: `otc_${this.nextId++}`,
      overtimeId: data.overtimeId,
      field: data.field,
      oldValue: data.oldValue ?? null,
      newValue: data.newValue ?? null,
      reason: data.reason,
      correctedBy: data.correctedBy ?? null,
      correctedAt: data.correctedAt ?? new Date(),
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findByOvertimeId(overtimeId) {
    return this.entries.filter((e) => String(e.overtimeId) === String(overtimeId));
  }

  async listByOvertime(overtimeId) {
    return this.findByOvertimeId(overtimeId);
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
  const overtimeCorrectionRepository = new InMemoryOvertimeCorrectionRepository();
  const service = new OvertimeAdminService({
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
    overtimeCorrectionRepository,
    auditService,
    ...overrides,
  });
  return { service, fakes, auditService, overtimeCorrectionRepository };
}

function seedUser(fakes, { id, departmentId = null }) {
  fakes.userRepository.seed({
    id,
    username: id,
    email: `${id}@corp.io`,
    name: id,
    status: "ACTIVE",
    departmentId,
  });
  return id;
}

function seedOvertime(fakes, { requesterId, employeeId = requesterId, overtimeDate = "2026-08-01", status = "PENDING" }) {
  return fakes.requestRepository.create({
    type: "OVERTIME",
    requesterId,
    payload: {
      employeeId,
      overtimeDate,
      startTime: "18:00",
      endTime: "22:00",
      reason: "Client work",
    },
    status,
  });
}

test("listOverviews returns only overtime requests enriched with requester identity (FR-055)", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  seedUser(fakes, { id: "u_emp2" });
  await seedOvertime(fakes, { requesterId: "u_emp1" });
  await seedOvertime(fakes, { requesterId: "u_emp2" });
  await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp1",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-12", reason: "holiday" },
    status: "APPROVED",
  });

  const result = await service.listOverviews({});

  assert.equal(result.total, 2);
  assert.ok(result.items.every((item) => item.type === "OVERTIME"));
  const emp1 = result.items.find((item) => item.requesterId === "u_emp1");
  assert.equal(emp1.requester.name, "u_emp1");
  assert.equal(emp1.overtimeDate, "2026-08-01");
  assert.equal(emp1.startTime, "18:00");
});

test("listOverviews filters by employeeId, status, and date range", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  seedUser(fakes, { id: "u_emp2" });
  const a = await seedOvertime(fakes, { requesterId: "u_emp1", status: "APPROVED" });
  const b = await seedOvertime(fakes, { requesterId: "u_emp2", status: "PENDING" });
  a.submittedAt = new Date("2026-08-01T10:00:00.000Z");
  b.submittedAt = new Date("2026-08-03T10:00:00.000Z");

  const byEmployee = await service.listOverviews({ employeeId: "u_emp1" });
  assert.equal(byEmployee.total, 1);
  assert.equal(byEmployee.items[0].requesterId, "u_emp1");

  const byStatus = await service.listOverviews({ status: "APPROVED" });
  assert.equal(byStatus.total, 1);
  assert.equal(byStatus.items[0].requesterId, "u_emp1");

  const ranged = await service.listOverviews({ from: "2026-08-02", to: "2026-08-31" });
  assert.equal(ranged.total, 1);
  assert.equal(ranged.items[0].requesterId, "u_emp2");
});

test("listOverviews filters by departmentId via the requester's department", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp1", departmentId: "dept_a" });
  seedUser(fakes, { id: "u_emp2", departmentId: "dept_b" });
  await seedOvertime(fakes, { requesterId: "u_emp1" });
  await seedOvertime(fakes, { requesterId: "u_emp2" });

  const result = await service.listOverviews({ departmentId: "dept_a" });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].requesterId, "u_emp1");
});

test("listOverviews paginates after filtering", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  for (let i = 0; i < 5; i += 1) {
    await seedOvertime(fakes, { requesterId: "u_emp1", overtimeDate: `2026-08-0${i + 1}` });
  }

  const page1 = await service.listOverviews({ page: 1, pageSize: 2 });
  const page2 = await service.listOverviews({ page: 2, pageSize: 2 });

  assert.equal(page1.total, 5);
  assert.equal(page1.items.length, 2);
  assert.equal(page2.items.length, 2);
});

test("getById returns overtime detail with correction history; non-overtime answers 404", async () => {
  const { service, fakes, overtimeCorrectionRepository } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  const ot = await seedOvertime(fakes, { requesterId: "u_emp1", status: "APPROVED" });
  const leave = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp1",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-12", reason: "holiday" },
    status: "APPROVED",
  });

  const detail = await service.getById(ot.id);
  assert.equal(detail.type, "OVERTIME");
  assert.equal(detail.requester.id, "u_emp1");
  assert.deepEqual(detail.corrections, []);

  await overtimeCorrectionRepository.create({
    overtimeId: ot.id,
    field: "endTime",
    oldValue: "22:00",
    newValue: "23:00",
    reason: "Approver override.",
    correctedBy: "u_hr",
  });
  const detail2 = await service.getById(ot.id);
  assert.equal(detail2.corrections.length, 1);
  assert.equal(detail2.corrections[0].field, "endTime");

  await assert.rejects(service.getById(leave.id), NotFoundError);
  await assert.rejects(service.getById("req_missing"), NotFoundError);
});

test("correct appends a correction, audits, and never mutates the original request (FR-055)", async () => {
  const { service, fakes, overtimeCorrectionRepository } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  const ot = await seedOvertime(fakes, { requesterId: "u_emp1", status: "APPROVED" });

  const actor = {
    actorId: "u_hr",
    actorRoleKeys: ["HR_ADMIN"],
    ip: "10.0.0.9",
    userAgent: "test-agent",
    correlationId: "c9",
  };

  const correction = await service.correct(
    {
      overtimeId: ot.id,
      field: "endTime",
      oldValue: "22:00",
      newValue: "23:00",
      reason: "Approver extended the shift.",
    },
    actor
  );

  assert.equal(correction.field, "endTime");
  assert.equal(correction.oldValue, "22:00");
  assert.equal(correction.newValue, "23:00");
  assert.equal(correction.reason, "Approver extended the shift.");
  assert.equal(correction.correctedBy, "u_hr");

  // The original request is untouched (audit-trail semantics).
  assert.equal((await fakes.requestRepository.findById(ot.id)).payload.endTime, "22:00");

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "OVERTIME.CORRECTED"
  );
  assert.ok(audit, "correction is audited");
  assert.equal(audit.metadata.overtimeId, ot.id);
  assert.equal(audit.metadata.field, "endTime");
  assert.equal(audit.metadata.oldValue, "22:00");
  assert.equal(audit.metadata.newValue, "23:00");
  assert.equal(audit.actor.userId, "u_hr");

  // Append-only: a second correction preserves the first.
  await service.correct(
    {
      overtimeId: ot.id,
      field: "reason",
      oldValue: "Client work",
      newValue: "Client demo",
      reason: "Correction to the reason.",
    },
    actor
  );
  const all = await overtimeCorrectionRepository.listByOvertime(ot.id);
  assert.equal(all.length, 2);
});

test("correct rejects a missing reason with ValidationError", async () => {
  const { service, fakes, overtimeCorrectionRepository } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  const ot = await seedOvertime(fakes, { requesterId: "u_emp1" });

  await assert.rejects(
    service.correct(
      { overtimeId: ot.id, field: "endTime", oldValue: "22:00", newValue: "23:00", reason: "" },
      { actorId: "u_hr" }
    ),
    (err) => err instanceof ValidationError && err.details.field === "reason"
  );
  assert.equal(overtimeCorrectionRepository.entries.length, 0);
  assert.ok(
    !fakes.auditRepository.entries.some((e) => e.action === "OVERTIME.CORRECTED")
  );
});

test("correct answers 404 for a missing or non-overtime request", async () => {
  const { service, fakes, overtimeCorrectionRepository } = makeService();
  seedUser(fakes, { id: "u_emp1" });
  const leave = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp1",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-12", reason: "holiday" },
    status: "APPROVED",
  });

  await assert.rejects(
    service.correct(
      { overtimeId: leave.id, field: "endTime", oldValue: null, newValue: null, reason: "x" },
      { actorId: "u_hr" }
    ),
    NotFoundError
  );
  await assert.rejects(
    service.correct(
      { overtimeId: "req_missing", field: "endTime", oldValue: null, newValue: null, reason: "x" },
      { actorId: "u_hr" }
    ),
    NotFoundError
  );
  assert.equal(overtimeCorrectionRepository.entries.length, 0);
});
