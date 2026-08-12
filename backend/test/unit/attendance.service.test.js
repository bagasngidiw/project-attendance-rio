/**
 * AttendanceService tests (FR-035 / FR-020 / FR-041): clock in/out rules,
 * personal history scope, HR overview, corrections, and the pending provider.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { AttendanceService } = require("../../src/application/attendance.service");
const { NotFoundError, ValidationError, ConflictError } = require("../../src/domain/errors");

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
  const pendingSummaryService = new PendingSummaryService();
  const service = new AttendanceService({
    attendanceRepository: fakes.attendanceRepository,
    userRepository: fakes.userRepository,
    requestRepository: fakes.requestRepository,
    correctionModel: fakes.attendanceCorrectionModel,
    pendingSummaryService,
    auditService,
    config: {
      security: {
        companyTimezoneOffsetMs: 0,
        attendance: { requireCamera: false, requireLocation: false, maxAccuracyMeters: 0 },
      },
    },
    ...overrides,
  });
  return { service, fakes, auditService, pendingSummaryService };
}

function seedUser(fakes, { id = "u_emp", name = "Emp", ...extra } = {}) {
  fakes.userRepository.seed({
    id,
    username: id,
    email: `${id}@corp.io`,
    name,
    status: "ACTIVE",
    ...extra,
  });
  return id;
}

test("clockIn opens a work period; a second clock-in is blocked (F1)", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes);

  const first = await service.clockIn("u_emp", { actorId: "u_emp" });
  assert.equal(first.clockOutAt, null);
  assert.equal(first.status, "NORMAL");

  await assert.rejects(
    service.clockIn("u_emp", {}),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );

  assert.ok(
    fakes.activityRepository.entries.some((e) => e.action === "ATTENDANCE.CLOCKED_IN")
  );
});

test("clockOut closes the open period; clock-out without an open period is blocked (F1)", async () => {
  let current = new Date("2026-08-06T08:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {});
  await service.clockIn("u_emp", {});
  current = new Date("2026-08-06T17:00:00.000Z");
  const closed = await service.clockOut("u_emp", {});
  assert.ok(closed.clockOutAt);
  assert.equal(closed.status, "NORMAL", "a 9-hour shift is NORMAL");

  await assert.rejects(
    service.clockOut("u_emp", {}),
    (err) => err instanceof ConflictError && err.code === "INVALID_CLOCK_ACTION"
  );

  await assert.rejects(service.clockOut("u_other", {}), ConflictError);
});

test("getToday returns the current open record or null", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, {});
  assert.equal(await service.getToday("u_emp"), null);
  await service.clockIn("u_emp", {});
  const today = await service.getToday("u_emp");
  assert.equal(today.clockOutAt, null);
});

test("listOwn is scoped to the owner with date filters", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp" });
  seedUser(fakes, { id: "u_other" });
  await service.clockIn("u_emp", {});
  await service.clockIn("u_other", {});

  const mine = await service.listOwn("u_emp", {});
  assert.equal(mine.total, 1);
  assert.ok(mine.items.every((r) => String(r.userId) === "u_emp"));
});

test("getByIdScoped: owner and HR can read; unrelated users get 404", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp" });
  seedUser(fakes, { id: "u_other" });
  const record = await service.clockIn("u_emp", {});

  const ownerView = await service.getByIdScoped(record.id, "u_emp", { canViewAll: false });
  assert.equal(ownerView.id, record.id);

  const hrView = await service.getByIdScoped(record.id, "u_hr", { canViewAll: true });
  assert.equal(hrView.id, record.id);

  await assert.rejects(
    service.getByIdScoped(record.id, "u_other", { canViewAll: false }),
    NotFoundError
  );
});

test("listOverview requires view-all and supports filters", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp", name: "Emp" });
  seedUser(fakes, { id: "u_other", name: "Other" });
  await service.clockIn("u_emp", {});
  await service.clockIn("u_other", {});

  const overview = await service.listOverview({ actorId: "u_hr", canViewAll: true, filters: {} });
  assert.equal(overview.total, 2);
  assert.ok(overview.items[0].user, "overview enriched with owner identity");

  await assert.rejects(
    service.listOverview({ actorId: "u_emp", canViewAll: false, filters: {} }),
    NotFoundError,
    "non-view-all callers are rejected (no existence leak)"
  );
});

test("correct requires a reason, blocks self-correction, and preserves the old value (F3/F5)", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp" });
  const record = await service.clockIn("u_emp", {});
  const oldValue = record.clockInAt; // ISO string from the DTO
  const newValue = new Date(new Date(oldValue).getTime() - 5 * 60 * 1000);

  await assert.rejects(
    service.correct(record.id, { field: "clockInAt", oldValue: null, newValue: null, reason: "" }, { actorId: "u_hr" }),
    (err) => err instanceof ValidationError && err.details.field === "reason"
  );

  await assert.rejects(
    service.correct(record.id, { field: "clockInAt", oldValue: null, newValue: null, reason: "x" }, { actorId: "u_emp" }),
    (err) => err instanceof ConflictError && err.code === "SELF_CORRECTION_DENIED"
  );

  const result = await service.correct(
    record.id,
    {
      field: "clockInAt",
      oldValue,
      newValue: newValue.toISOString(),
      reason: "Employee reported system delay.",
    },
    { actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] }
  );

  assert.equal(result.field, "clockInAt");
  assert.equal(result.oldValue, oldValue);
  assert.equal(result.newValue, newValue.toISOString());

  const stored = fakes.attendanceRepository.records.get(record.id);
  assert.equal(new Date(stored.clockInAt).toISOString(), newValue.toISOString(), "record updated");
  assert.equal(stored.source, "CORRECTION");

  const corrections = await fakes.attendanceRepository.listCorrections(record.id);
  assert.equal(corrections.length, 1, "correction history is append-only");

  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "ATTENDANCE.CORRECTED"));
});

test("correct rejects a stale oldValue (concurrent change)", async () => {
  const { service, fakes } = makeService();
  seedUser(fakes, { id: "u_emp" });
  const record = await service.clockIn("u_emp", {});

  // An oldValue that does not match the current stored value is rejected.
  await assert.rejects(
    service.correct(
      record.id,
      { field: "clockInAt", oldValue: new Date(0).toISOString(), newValue: null, reason: "stale" },
      { actorId: "u_hr" }
    ),
    ConflictError
  );
});

test("the attendance pending provider counts open shifts (F4)", async () => {
  const { service, fakes, pendingSummaryService } = makeService();
  seedUser(fakes, { id: "u_emp" });
  seedUser(fakes, { id: "u_other" });
  await service.clockIn("u_emp", {});
  await service.clockIn("u_other", {});
  await service.clockOut("u_emp", {});

  const summary = await pendingSummaryService.getPendingSummary(["u_emp", "u_other"]);
  assert.equal(summary.attendance, 1, "only u_other still has an open shift");
});

test("clockIn marks ON_TIME when clock-in is within the scheduled start", async () => {
  const current = new Date("2026-08-06T07:30:00.000Z"); // Thursday
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {
    id: "u_emp",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
  });

  const record = await service.clockIn("u_emp", {});
  assert.equal(record.punctuality, "ON_TIME");
});

test("clockIn marks LATE when clock-in is after the scheduled start", async () => {
  const current = new Date("2026-08-06T08:30:00.000Z"); // Thursday
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {
    id: "u_emp",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
  });

  const record = await service.clockIn("u_emp", {});
  assert.equal(record.punctuality, "LATE");
});

test("clockIn punctuality is null when the day is not a working day", async () => {
  const current = new Date("2026-08-09T08:30:00.000Z"); // Sunday
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {
    id: "u_emp",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
  });

  const record = await service.clockIn("u_emp", {});
  assert.equal(record.punctuality, null);
});

test("clockIn punctuality is null without a configured start time", async () => {
  const current = new Date("2026-08-06T09:00:00.000Z"); // Thursday
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, { id: "u_emp", workingDays: [1, 2, 3, 4, 5] });

  const record = await service.clockIn("u_emp", {});
  assert.equal(record.punctuality, null);
});

test("correcting clockInAt recomputes punctuality from the new value", async () => {
  let current = new Date("2026-08-06T08:30:00.000Z"); // late
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {
    id: "u_emp",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
  });

  const record = await service.clockIn("u_emp", {});
  assert.equal(record.punctuality, "LATE");

  current = new Date("2026-08-06T07:45:00.000Z"); // corrected to on-time
  await service.correct(
    record.id,
    {
      field: "clockInAt",
      oldValue: new Date("2026-08-06T08:30:00.000Z").toISOString(),
      newValue: new Date("2026-08-06T07:45:00.000Z").toISOString(),
      reason: "Perangkat clock-in mengalami kesalahan sinkronisasi jam.",
    },
    { actorId: "u_hr" }
  );
  const stored = await fakes.attendanceRepository.findById(record.id);
  assert.equal(stored.punctuality, "ON_TIME");
});

test("clockIn DTO exposes punctuality to the client", async () => {
  const current = new Date("2026-08-06T07:45:00.000Z"); // Thursday
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, {
    id: "u_emp",
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "08:00",
  });

  const dto = await service.toDto(await service.clockIn("u_emp", {}));
  assert.equal(dto.punctuality, "ON_TIME");
});

/* ---------------- FR-001: approved leave integration ---------------- */

/** Seeds an APPROVED LEAVE request covering [from, to] for a user. */
async function seedApprovedLeave(fakes, { requesterId = "u_emp", from = "2026-09-01", to = "2026-09-03" } = {}) {
  return fakes.requestRepository.create({
    type: "LEAVE",
    requesterId,
    payload: { startDate: from, endDate: to, reason: "Vacation" },
    status: "APPROVED",
  });
}

test("FR-001: clockIn is blocked when today is covered by approved leave", async () => {
  const current = new Date("2026-09-02T08:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, { id: "u_emp" });
  await seedApprovedLeave(fakes, {});

  await assert.rejects(
    service.clockIn("u_emp", {}),
    (err) => err instanceof ConflictError && err.code === "ON_APPROVED_LEAVE"
  );
  assert.equal(fakes.attendanceRepository.records.size, 0, "no record created");
});

test("FR-001: clockOut is blocked when today's record is a LEAVE record", async () => {
  const current = new Date("2026-09-02T17:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, { id: "u_emp" });
  await fakes.attendanceRepository.createLeaveIfAbsent({ userId: "u_emp", date: "2026-09-02" });

  await assert.rejects(
    service.clockOut("u_emp", {}),
    (err) => err instanceof ConflictError && err.code === "ON_APPROVED_LEAVE"
  );
});

test("FR-001: getToday returns a LEAVE marker when covered but sync has not run", async () => {
  const current = new Date("2026-09-02T08:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, { id: "u_emp" });
  await seedApprovedLeave(fakes, {});

  const today = await service.getToday("u_emp");
  assert.ok(today, "leave marker surfaced");
  assert.equal(today.status, "LEAVE");
  assert.equal(today.clockInAt, null);
  assert.equal(today.clockOutAt, null);
});

test("FR-001: getToday returns the existing LEAVE record when present", async () => {
  const current = new Date("2026-09-02T08:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current });
  seedUser(fakes, { id: "u_emp" });
  await fakes.attendanceRepository.createLeaveIfAbsent({ userId: "u_emp", date: "2026-09-02" });

  const today = await service.getToday("u_emp");
  assert.equal(today.status, "LEAVE");
  assert.ok(today.id, "real record id returned");
});

test("FR-001: non-leave days are unaffected when no request repository is wired", async () => {
  const current = new Date("2026-09-02T08:00:00.000Z");
  const { service, fakes } = makeService({ now: () => current, requestRepository: null });
  seedUser(fakes, { id: "u_emp" });
  await seedApprovedLeave(fakes, {});

  // Without the request repository the coverage query is skipped (unit test
  // isolation); clock-in still proceeds for non-leave records.
  const record = await service.clockIn("u_emp", {});
  assert.equal(record.status, "NORMAL");
});
