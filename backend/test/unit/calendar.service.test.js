/**
 * CalendarService tests (FR-059): holiday CRUD with audit, timezone-aware
 * storage, the working-day calendar, and the isWorkingDay predicate.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { CalendarService } = require("../../src/application/calendar.service");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

/** In-memory holiday repository mirroring HolidayRepository semantics. */
class InMemoryHolidayRepository {
  constructor() {
    this.records = new Map();
    this.nextId = 1;
  }

  async create({ date, name, repeatYearly = false, updatedBy = null }) {
    const id = `hol_${this.nextId++}`;
    const record = {
      id,
      date: date instanceof Date ? new Date(date) : new Date(date),
      name,
      repeatYearly,
      status: "ACTIVE",
      updatedBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(id, record);
    return { ...record };
  }

  async getById(id) {
    const record = this.records.get(String(id));
    if (!record) {
      throw new NotFoundError("Holiday not found.", "HOLIDAY_NOT_FOUND");
    }
    return { ...record };
  }

  async listActive() {
    return this.sorted([...this.records.values()].filter((r) => r.status === "ACTIVE"));
  }

  async listActiveBetween(from, to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return this.sorted(
      [...this.records.values()].filter(
        (r) =>
          r.status === "ACTIVE" &&
          new Date(r.date) >= fromDate &&
          new Date(r.date) <= toDate
      )
    );
  }

  async update(id, input) {
    const record = this.records.get(String(id));
    if (!record) return null;
    Object.assign(record, input, { updatedAt: new Date() });
    return { ...record };
  }

  async setStatus(id, status, updatedBy) {
    const record = this.records.get(String(id));
    if (!record) return null;
    record.status = status;
    if (updatedBy) record.updatedBy = updatedBy;
    record.updatedAt = new Date();
    return { ...record };
  }

  async listAll() {
    return this.sorted([...this.records.values()]);
  }

  sorted(items) {
    return items.sort((a, b) => new Date(a.date) - new Date(b.date)).map((r) => ({ ...r }));
  }
}

function makeService() {
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
  const service = new CalendarService({
    holidayRepository: new InMemoryHolidayRepository(),
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
  });
  return { service, fakes };
}

const ACTOR = { actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] };

test("getTimezone defaults to UTC and reads the configured offset", async () => {
  const { service, fakes } = makeService();
  assert.deepEqual(await service.getTimezone(), { offsetMs: 0 });
  await fakes.platformSettingRepository.set("companyTimezoneOffsetMs", 7 * 3600e3);
  assert.deepEqual(await service.getTimezone(), { offsetMs: 7 * 3600e3 });
});

test("createHoliday validates input and audits CALENDAR.HOLIDAY_CREATED", async () => {
  const { service, fakes } = makeService();
  const holiday = await service.createHoliday(
    { date: "2026-09-01", name: "National Day", repeatYearly: true },
    ACTOR
  );
  assert.equal(holiday.date, "2026-09-01");
  assert.equal(holiday.name, "National Day");
  assert.equal(holiday.repeatYearly, true);
  assert.equal(holiday.status, "ACTIVE");

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "CALENDAR.HOLIDAY_CREATED"
  );
  assert.ok(audit, "HOLIDAY_CREATED audited");
  assert.equal(audit.actor.userId, "u_hr");
  assert.equal(audit.metadata.date, "2026-09-01");
});

test("createHoliday rejects invalid input", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.createHoliday({ date: "2026-09-01", name: "" }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  await assert.rejects(
    service.createHoliday({ date: "2026-02-30", name: "X" }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "date"
  );
});

test("holiday dates are stored as local midnight for the company timezone", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("companyTimezoneOffsetMs", 7 * 3600e3);
  const holiday = await service.createHoliday(
    { date: "2026-09-01", name: "National Day" },
    ACTOR
  );
  assert.equal(holiday.date, "2026-09-01");
  // Rendered back through toWorkDay for the same offset yields the same key.
  const stored = service.holidayRepository.records.get(holiday.id);
  assert.equal(stored.date.toISOString(), "2026-08-31T17:00:00.000Z");
});

test("listHolidays returns active holidays within an inclusive range", async () => {
  const { service } = makeService();
  await service.createHoliday({ date: "2026-09-01", name: "A" }, ACTOR);
  const inactive = await service.createHoliday({ date: "2026-09-05", name: "B" }, ACTOR);
  await service.deactivateHoliday(inactive.id, ACTOR);
  await service.createHoliday({ date: "2026-10-01", name: "C" }, ACTOR);

  const items = await service.listHolidays({ from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(items.map((i) => i.name), ["A"]);
});

test("updateHoliday changes fields and audits CALENDAR.HOLIDAY_UPDATED", async () => {
  const { service, fakes } = makeService();
  const holiday = await service.createHoliday({ date: "2026-09-01", name: "A" }, ACTOR);

  const updated = await service.updateHoliday(
    holiday.id,
    { name: "Renamed", date: "2026-09-02", repeatYearly: true },
    ACTOR
  );
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.date, "2026-09-02");
  assert.equal(updated.repeatYearly, true);

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "CALENDAR.HOLIDAY_UPDATED"
  );
  assert.ok(audit, "HOLIDAY_UPDATED audited");
  assert.equal(audit.metadata.name, "Renamed");
  assert.equal(audit.metadata.date, "2026-09-02");
});

test("updateHoliday partial update keeps unspecified fields", async () => {
  const { service } = makeService();
  const holiday = await service.createHoliday(
    { date: "2026-09-01", name: "A", repeatYearly: true },
    ACTOR
  );
  const updated = await service.updateHoliday(holiday.id, { name: "B" }, ACTOR);
  assert.equal(updated.name, "B");
  assert.equal(updated.date, "2026-09-01", "date preserved");
  assert.equal(updated.repeatYearly, true, "repeatYearly preserved");
});

test("updateHoliday rejects invalid next state and missing ids", async () => {
  const { service } = makeService();
  const holiday = await service.createHoliday({ date: "2026-09-01", name: "A" }, ACTOR);
  await assert.rejects(
    service.updateHoliday(holiday.id, { name: "" }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  await assert.rejects(
    service.updateHoliday("missing", { name: "X" }, ACTOR),
    (err) => err instanceof NotFoundError && err.code === "HOLIDAY_NOT_FOUND"
  );
});

test("deactivate/activate flip status and audit the lifecycle", async () => {
  const { service, fakes } = makeService();
  const holiday = await service.createHoliday({ date: "2026-09-01", name: "A" }, ACTOR);

  const deactivated = await service.deactivateHoliday(holiday.id, ACTOR);
  assert.equal(deactivated.status, "INACTIVE");
  assert.ok(
    fakes.auditRepository.entries.some((e) => e.action === "CALENDAR.HOLIDAY_DEACTIVATED")
  );
  assert.ok(
    (await service.listHolidays({ from: "2026-01-01", to: "2026-12-31" })).length === 0
  );

  const reactivated = await service.activateHoliday(holiday.id, ACTOR);
  assert.equal(reactivated.status, "ACTIVE");
  assert.ok(
    fakes.auditRepository.entries.some((e) => e.action === "CALENDAR.HOLIDAY_ACTIVATED")
  );

  await assert.rejects(
    service.deactivateHoliday("missing", ACTOR),
    (err) => err instanceof NotFoundError && err.code === "HOLIDAY_NOT_FOUND"
  );
});

test("getWorkingDayCalendar lists holidays and weekend days", async () => {
  const { service } = makeService();
  // 2026-08-10 (Mon) and 2026-08-11 (Tue) holidays; range Mon-Sun.
  await service.createHoliday({ date: "2026-08-10", name: "Mon Holiday" }, ACTOR);
  await service.createHoliday({ date: "2026-08-11", name: "Tue Holiday" }, ACTOR);

  const calendar = await service.getWorkingDayCalendar({
    from: "2026-08-10",
    to: "2026-08-16",
  });
  assert.deepEqual(calendar.holidays.map((h) => h.date), ["2026-08-10", "2026-08-11"]);
  // Weekend days are 15 (Sat) and 16 (Sun); the 10th/11th are holidays, not weekends.
  assert.deepEqual(calendar.weekendDays, ["2026-08-15", "2026-08-16"]);
  assert.equal(calendar.from, "2026-08-10");
  assert.equal(calendar.to, "2026-08-16");
});

test("getWorkingDayCalendar respects the company timezone offset", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("companyTimezoneOffsetMs", 7 * 3600e3);
  await service.createHoliday({ date: "2026-08-10", name: "Mon Holiday" }, ACTOR);

  const calendar = await service.getWorkingDayCalendar({
    from: "2026-08-10",
    to: "2026-08-16",
  });
  assert.deepEqual(calendar.holidays.map((h) => h.date), ["2026-08-10"]);
  assert.deepEqual(calendar.weekendDays, ["2026-08-15", "2026-08-16"]);
});

test("getWorkingDayCalendar rejects an inverted range", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.getWorkingDayCalendar({ from: "2026-08-16", to: "2026-08-10" }),
    (err) => err instanceof ValidationError && err.details.field === "from"
  );
});

test("isWorkingDay evaluates weekdays, weekends, and holidays in the company timezone", async () => {
  const { service } = makeService();
  await service.createHoliday({ date: "2026-08-11", name: "Tue Holiday" }, ACTOR);

  assert.equal(await service.isWorkingDay("2026-08-10"), true, "Monday working");
  assert.equal(await service.isWorkingDay("2026-08-11"), false, "holiday off");
  assert.equal(await service.isWorkingDay("2026-08-15"), false, "Saturday off");
  assert.equal(await service.isWorkingDay("2026-08-16"), false, "Sunday off");
});

test("getHolidaysBetween returns holiday DTOs for the leave day-count", async () => {
  const { service } = makeService();
  await service.createHoliday({ date: "2026-08-11", name: "Tue Holiday" }, ACTOR);
  const holidays = await service.getHolidaysBetween("2026-08-10", "2026-08-14");
  assert.deepEqual(
    holidays.map((h) => ({ date: h.date, name: h.name })),
    [{ date: "2026-08-11", name: "Tue Holiday" }]
  );
});
