/**
 * AttendanceLeaveSyncService tests (FR-001): APPROVED leave -> LEAVE attendance
 * records for each covered date, idempotent and non-destructive; rejected or
 * non-leave events produce nothing; failures never propagate.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { AttendanceLeaveSyncService, enumerateDateKeys } = require("../../src/application/attendance-leave-sync.service");

function makeService(overrides = {}) {
  const fakes = buildFakes();
  const bus = new EventBus();
  const service = new AttendanceLeaveSyncService({
    attendanceRepository: fakes.attendanceRepository,
    requestRepository: fakes.requestRepository,
    logger: { error: () => {} },
    ...overrides,
  });
  service.subscribeToEvents(bus);
  return { service, fakes, bus };
}

async function seedApprovedLeave(fakes, { requesterId = "u_emp", startDate = "2026-09-01", endDate = "2026-09-03" } = {}) {
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId,
    payload: { startDate, endDate, reason: "Vacation" },
    status: "APPROVED",
  });
  return request;
}

test("enumerateDateKeys iterates inclusive YYYY-MM-DD bounds", () => {
  assert.deepEqual(enumerateDateKeys("2026-09-01", "2026-09-03"), [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
  ]);
  assert.deepEqual(enumerateDateKeys("2026-09-05", "2026-09-05"), ["2026-09-05"]);
  assert.deepEqual(enumerateDateKeys("not-a-date", "2026-09-03"), []);
});

test("an APPROVED leave decision creates LEAVE records for every covered date", async () => {
  const { service, fakes, bus } = makeService();
  const request = await seedApprovedLeave(fakes, { startDate: "2026-09-01", endDate: "2026-09-03" });

  await bus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });

  const record1 = await fakes.attendanceRepository.findByUserAndDate("u_emp", "2026-09-01");
  const record2 = await fakes.attendanceRepository.findByUserAndDate("u_emp", "2026-09-02");
  const record3 = await fakes.attendanceRepository.findByUserAndDate("u_emp", "2026-09-03");
  assert.ok(record1, "record created for first date");
  assert.equal(record1.status, "LEAVE");
  assert.equal(record1.clockInAt, null);
  assert.ok(record2, "record created for middle date");
  assert.ok(record3, "record created for last date");
  // All three dates exist.
  const dates = [...fakes.attendanceRepository.records.values()]
    .filter((r) => String(r.userId) === "u_emp")
    .map((r) => r.date)
    .sort();
  assert.deepEqual(dates, ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("sync is idempotent and never overwrites an existing attendance record", async () => {
  const { service, fakes, bus } = makeService();
  const request = await seedApprovedLeave(fakes, { startDate: "2026-09-01", endDate: "2026-09-01" });

  // The employee already clocked in on the covered date — actual data wins.
  await fakes.attendanceRepository.create({
    userId: "u_emp",
    date: "2026-09-01",
    clockInAt: new Date("2026-09-01T08:00:00Z"),
    status: "NORMAL",
  });

  await bus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });

  const record = await fakes.attendanceRepository.findByUserAndDate("u_emp", "2026-09-01");
  assert.equal(record.status, "NORMAL", "existing clocked record is preserved");
  assert.ok(record.clockInAt, "clock-in data untouched");

  // Publishing the same decision twice keeps exactly one record.
  await bus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });
  assert.equal(
    [...fakes.attendanceRepository.records.values()].filter(
      (r) => String(r.userId) === "u_emp" && r.date === "2026-09-01"
    ).length,
    1
  );
});

test("rejected, cancelled, and non-leave decisions produce no records", async () => {
  const { service, fakes, bus } = makeService();
  const request = await seedApprovedLeave(fakes, { startDate: "2026-09-01", endDate: "2026-09-02" });

  await bus.publish("request.decided", { requestId: request.id, type: "LEAVE", requesterId: "u_emp", toStatus: "REJECTED" });
  await bus.publish("request.decided", { requestId: request.id, type: "LEAVE", requesterId: "u_emp", toStatus: "CANCELLED" });
  await bus.publish("request.decided", { requestId: "other", type: "OVERTIME", requesterId: "u_emp", toStatus: "APPROVED" });

  assert.equal(fakes.attendanceRepository.records.size, 0);
});

test("a missing request or missing date range is a silent no-op", async () => {
  const { service, fakes, bus } = makeService();
  await bus.publish("request.decided", { requestId: "missing", type: "LEAVE", requesterId: "u_emp", toStatus: "APPROVED" });

  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { reason: "no dates" },
    status: "APPROVED",
  });
  await bus.publish("request.decided", { requestId: request.id, type: "LEAVE", requesterId: "u_emp", toStatus: "APPROVED" });

  assert.equal(fakes.attendanceRepository.records.size, 0);
});

test("a subscriber failure never propagates to the publisher (non-throwing)", async () => {
  const { service, fakes, bus } = makeService({
    attendanceRepository: {
      createLeaveIfAbsent: async () => {
        throw new Error("storage down");
      },
    },
  });
  const request = await seedApprovedLeave(fakes, { startDate: "2026-09-01", endDate: "2026-09-01" });

  await assert.doesNotReject(
    bus.publish("request.decided", {
      requestId: request.id,
      type: "LEAVE",
      requesterId: "u_emp",
      toStatus: "APPROVED",
    })
  );
});
