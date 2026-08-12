/**
 * LeaveBalanceService tests (FR-022): derived balances joined with leave
 * types, HR adjustments with audit, and EventBus-driven reservation,
 * release, and conversion on the request lifecycle.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { LeaveBalanceService } = require("../../src/application/leave-balance.service");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

/** In-memory leave-balance repository mirroring LeaveBalanceRepository. */
class InMemoryLeaveBalanceRepository {
  constructor() {
    this.records = new Map();
    this.nextId = 1;
  }

  key(userId, leaveTypeId, year) {
    return `${userId}|${leaveTypeId}|${year}`;
  }

  async findByUserAndType(userId, leaveTypeId, year) {
    const record = this.records.get(this.key(userId, leaveTypeId, year));
    return record ? { ...record } : null;
  }

  async listByUser(userId, year) {
    return [...this.records.values()]
      .filter((r) => r.userId === String(userId) && r.year === year)
      .map((r) => ({ ...r }));
  }

  async listByUsers(userIds, year) {
    const set = new Set(userIds.map(String));
    return [...this.records.values()]
      .filter((r) => set.has(r.userId) && r.year === year)
      .map((r) => ({ ...r }));
  }

  async upsert(userId, leaveTypeId, year, fields = {}) {
    const key = this.key(userId, leaveTypeId, year);
    let record = this.records.get(key);
    if (!record) {
      record = {
        id: `lb_${this.nextId++}`,
        userId: String(userId),
        leaveTypeId: String(leaveTypeId),
        year,
        entitlementDays: 0,
        adjustmentDays: 0,
        consumedDays: 0,
        reservedDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.records.set(key, record);
    }
    for (const field of ["entitlementDays", "adjustmentDays", "consumedDays", "reservedDays"]) {
      if (fields[field] !== undefined) record[field] = fields[field];
    }
    record.updatedAt = new Date();
    return { ...record };
  }

  async adjust(
    userId,
    leaveTypeId,
    year,
    { deltaEntitlement = 0, deltaAdjustment = 0, deltaConsumed = 0, deltaReserved = 0 } = {}
  ) {
    const key = this.key(userId, leaveTypeId, year);
    let record = this.records.get(key);
    if (!record) {
      record = {
        id: `lb_${this.nextId++}`,
        userId: String(userId),
        leaveTypeId: String(leaveTypeId),
        year,
        entitlementDays: 0,
        adjustmentDays: 0,
        consumedDays: 0,
        reservedDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.records.set(key, record);
    }
    record.entitlementDays += deltaEntitlement;
    record.adjustmentDays += deltaAdjustment;
    record.consumedDays += deltaConsumed;
    record.reservedDays += deltaReserved;
    record.updatedAt = new Date();
    return { ...record };
  }
}

function makeService({ calendarService = null } = {}) {
  const fakes = buildFakes();
  const eventBus = new EventBus();
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
  const leaveBalanceRepository = new InMemoryLeaveBalanceRepository();
  const service = new LeaveBalanceService({
    leaveBalanceRepository,
    leaveTypeRepository: fakes.leaveTypeRepository,
    requestRepository: fakes.requestRepository,
    calendarService,
    auditService,
  });
  service.subscribeToEvents(eventBus);
  return { service, fakes, eventBus, leaveBalanceRepository };
}

const ACTOR = { actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] };

async function seedAnnualLeaveType(fakes) {
  return fakes.leaveTypeRepository.create({
    key: "ANNUAL",
    name: "Annual Leave",
    isBalanceBased: true,
  });
}

async function seedBalance(repo, userId, leaveTypeId, counters) {
  return repo.upsert(userId, leaveTypeId, 2026, counters);
}

test("getBalancesForUser joins active leave types and computes balances", async () => {
  const { service, fakes, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await fakes.leaveTypeRepository.create({ key: "PERSONAL", name: "Personal Leave" });
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, {
    entitlementDays: 20,
    adjustmentDays: 2,
    consumedDays: 5,
    reservedDays: 3,
  });

  const items = await service.getBalancesForUser("u_emp", 2026);
  assert.equal(items.length, 2);

  const annualItem = items.find((i) => i.leaveTypeKey === "ANNUAL");
  assert.equal(annualItem.name, "Annual Leave");
  assert.equal(annualItem.balance, 14);
  assert.equal(annualItem.entitlementDays, 20);
  assert.equal(annualItem.reservedDays, 3);

  const personal = items.find((i) => i.leaveTypeKey === "PERSONAL");
  assert.deepEqual(
    { entitlementDays: personal.entitlementDays, balance: personal.balance },
    { entitlementDays: 0, balance: 0 }
  );
});

test("getBalancesForUser only surfaces ACTIVE leave types", async () => {
  const { service, fakes, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  const personal = await fakes.leaveTypeRepository.create({ key: "PERSONAL", name: "Personal" });
  await fakes.leaveTypeRepository.setStatus(personal.id, "INACTIVE", null);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });

  const items = await service.getBalancesForUser("u_emp", 2026);
  assert.deepEqual(items.map((i) => i.leaveTypeKey), ["ANNUAL"]);
});

test("getBalancesForUser rejects an invalid year", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.getBalancesForUser("u_emp", 1999),
    (err) => err instanceof ValidationError && err.details.field === "year"
  );
});

test("getBalanceForUser returns a single balance (zeros when absent)", async () => {
  const { service, fakes, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });

  const existing = await service.getBalanceForUser("u_emp", annual.id, 2026);
  assert.equal(existing.balance, 20);
  assert.equal(existing.leaveTypeKey, "ANNUAL");

  const missing = await service.getBalanceForUser("u_other", annual.id, 2026);
  assert.equal(missing.balance, 0);
  assert.equal(missing.entitlementDays, 0);
});

test("adjustBalance validates input, applies the delta, and audits", async () => {
  const { service, fakes, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });

  const updated = await service.adjustBalance({
    userId: "u_emp",
    leaveTypeId: annual.id,
    year: 2026,
    deltaDays: 3,
    reason: "New-hire top-up",
    actor: ACTOR,
  });
  assert.equal(updated.adjustmentDays, 3);
  assert.equal(updated.balance, 23);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "LEAVE.BALANCE_ADJUSTED"
  );
  assert.ok(audit, "BALANCE_ADJUSTED audited");
  assert.equal(audit.actor.userId, "u_hr");
  assert.equal(audit.metadata.deltaDays, 3);
  assert.equal(audit.metadata.reason, "New-hire top-up");
  assert.equal(audit.metadata.year, 2026);
});

test("adjustBalance rejects invalid deltas, years, and missing reasons", async () => {
  const { service, fakes } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  const base = { userId: "u_emp", leaveTypeId: annual.id, year: 2026, actor: ACTOR };

  await assert.rejects(
    service.adjustBalance({ ...base, deltaDays: 0, reason: "r" }),
    (err) => err instanceof ValidationError && err.details.field === "deltaDays"
  );
  await assert.rejects(
    service.adjustBalance({ ...base, deltaDays: 1, reason: "r", year: 1999 }),
    (err) => err instanceof ValidationError && err.details.field === "year"
  );
  await assert.rejects(
    service.adjustBalance({ ...base, deltaDays: 1, reason: "   " }),
    (err) => err instanceof ValidationError && err.details.field === "reason"
  );
});

test("adjustBalance rejects an unknown leave type", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.adjustBalance({
      userId: "u_emp",
      leaveTypeId: "lt_missing",
      year: 2026,
      deltaDays: 1,
      reason: "r",
      actor: ACTOR,
    }),
    (err) => err instanceof NotFoundError && err.code === "LEAVE_TYPE_NOT_FOUND"
  );
});

test("ensureBalance creates a zero row and leaves an existing row untouched", async () => {
  const { service, fakes, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);

  const created = await service.ensureBalance("u_emp", annual.id, 2026);
  assert.equal(created.entitlementDays, 0);
  assert.equal(created.adjustmentDays, 0);
  assert.ok(created.id, "row created");

  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });
  const existing = await service.ensureBalance("u_emp", annual.id, 2026);
  assert.equal(existing.entitlementDays, 20, "existing row returned unchanged");
});

/* ---------------- EventBus subscription behavior ---------------- */

test("request.submitted reserves raw day diff without a calendar service", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);

  await eventBus.publish("request.submitted", {
    requestId: "req_1",
    type: "LEAVE",
    requesterId: "u_emp",
    approverId: "u_mgr",
    payload: {
      leaveTypeId: annual.id,
      startDate: "2026-08-10",
      endDate: "2026-08-14",
      reason: "vacation",
    },
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 5, "Mon-Fri raw diff reserved");
});

test("request.submitted reserves business days when a calendar service is wired", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService({
    calendarService: {
      async getHolidaysBetween() {
        return [{ id: "hol_1", date: "2026-08-12", name: "Mid-week" }];
      },
    },
  });
  const annual = await seedAnnualLeaveType(fakes);

  await eventBus.publish("request.submitted", {
    requestId: "req_1",
    type: "LEAVE",
    requesterId: "u_emp",
    payload: {
      leaveTypeId: annual.id,
      startDate: "2026-08-10",
      endDate: "2026-08-14",
      reason: "vacation",
    },
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 4, "Mon-Fri minus the Wednesday holiday");
});

test("request.submitted falls back to raw day diff when the calendar fails", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService({
    calendarService: {
      async getHolidaysBetween() {
        throw new Error("calendar unavailable");
      },
    },
  });
  const annual = await seedAnnualLeaveType(fakes);

  await eventBus.publish("request.submitted", {
    requestId: "req_1",
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveTypeId: annual.id, startDate: "2026-08-10", endDate: "2026-08-14" },
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 5);
});

test("request.submitted resolves the leave type from its key", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);

  await eventBus.publish("request.submitted", {
    requestId: "req_1",
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-10" },
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 1);
});

test("request.submitted ignores non-leave events and unknown leave types", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);

  await eventBus.publish("request.submitted", {
    requestId: "req_1",
    type: "OVERTIME",
    requesterId: "u_emp",
    payload: {},
  });
  await eventBus.publish("request.submitted", {
    requestId: "req_2",
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { startDate: "2026-08-10", endDate: "2026-08-12" },
  });

  assert.equal(
    await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026),
    null,
    "no reservation for non-leave or unresolved leave types"
  );
});

test("request.cancelled releases the reservation", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveTypeId: annual.id, startDate: "2026-08-10", endDate: "2026-08-14" },
    status: "PENDING",
  });
  await leaveBalanceRepository.adjust("u_emp", annual.id, 2026, { deltaReserved: 5 });

  await eventBus.publish("request.cancelled", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    reason: "plans changed",
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 0);
  assert.equal(record.consumedDays, 0);
});

test("request.decided APPROVED converts the reservation into consumption", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveTypeId: annual.id, startDate: "2026-08-10", endDate: "2026-08-14" },
    status: "PENDING",
  });
  await leaveBalanceRepository.adjust("u_emp", annual.id, 2026, { deltaReserved: 5 });

  await eventBus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 0);
  assert.equal(record.consumedDays, 5);
  assert.equal(record.entitlementDays, 20);
});

test("request.decided REJECTED releases the reservation", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveTypeId: annual.id, startDate: "2026-08-10", endDate: "2026-08-14" },
    status: "PENDING",
  });
  await leaveBalanceRepository.adjust("u_emp", annual.id, 2026, { deltaReserved: 5 });

  await eventBus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "REJECTED",
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 0);
  assert.equal(record.consumedDays, 0);
});

test("lifecycle: submitted -> approved lands exactly the business days consumed", async () => {
  const { service, fakes, eventBus, leaveBalanceRepository } = makeService();
  const annual = await seedAnnualLeaveType(fakes);
  await seedBalance(leaveBalanceRepository, "u_emp", annual.id, { entitlementDays: 20 });

  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-14" },
    status: "PENDING",
  });

  await eventBus.publish("request.submitted", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveType: "ANNUAL", startDate: "2026-08-10", endDate: "2026-08-14" },
  });
  await eventBus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });

  const record = await leaveBalanceRepository.findByUserAndType("u_emp", annual.id, 2026);
  assert.equal(record.reservedDays, 0);
  assert.equal(record.consumedDays, 5);
  assert.equal(record.entitlementDays, 20);
});

test("request.cancelled for a missing request is a no-op", async () => {
  const { service, eventBus, leaveBalanceRepository } = makeService();
  await eventBus.publish("request.cancelled", {
    requestId: "req_missing",
    type: "LEAVE",
    requesterId: "u_emp",
  });
  assert.equal(leaveBalanceRepository.records.size, 0);
});

test("decided for a missing request is a no-op", async () => {
  const { service, eventBus, leaveBalanceRepository } = makeService();
  await eventBus.publish("request.decided", {
    requestId: "req_missing",
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });
  assert.equal(leaveBalanceRepository.records.size, 0);
});
