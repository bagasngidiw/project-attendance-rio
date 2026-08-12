/**
 * BusinessRuleService tests (FR-046): defaults when unset, reads of stored
 * rules, enforcement on payloads, and the OvertimeService / TripService
 * enforcement hook (backwards compatible when the dep is absent).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { BusinessRuleService } = require("../../src/application/business-rule.service");
const { OvertimeService } = require("../../src/application/overtime.service");
const { TripService } = require("../../src/application/trip.service");
const {
  OVERTIME_RULES_DEFAULTS,
  TRIP_RULES_DEFAULTS,
} = require("../../src/domain/business-rules");
const { ValidationError } = require("../../src/domain/errors");

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function makeService() {
  const fakes = buildFakes();
  const service = new BusinessRuleService({
    platformSettingRepository: fakes.platformSettingRepository,
  });
  return { service, fakes };
}

function makeThinWrappers(fakes) {
  const calls = [];
  const requestService = {
    submitRequest: async (input) => {
      calls.push(input);
      return { id: "req_1", type: input.type, requesterId: input.requesterId, status: "PENDING" };
    },
  };
  const pendingSummaryService = { registerProvider: () => {} };
  const businessRuleService = new BusinessRuleService({
    platformSettingRepository: fakes.platformSettingRepository,
  });
  const overtimeService = new OvertimeService({
    requestService,
    pendingSummaryService,
    businessRuleService,
  });
  const tripService = new TripService({
    requestService,
    pendingSummaryService,
    businessRuleService,
  });
  return { calls, requestService, overtimeService, tripService };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

test("business-rule getRulesForType returns defaults when unset", async () => {
  const { service } = makeService();
  assert.deepEqual(await service.getRulesForType("overtime"), OVERTIME_RULES_DEFAULTS);
  assert.deepEqual(await service.getRulesForType("trip"), TRIP_RULES_DEFAULTS);
});

test("business-rule getRulesForType reads stored rules", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("overtimeRules", {
    maxHoursPerDay: 8,
    advanceNoticeHours: 6,
  });
  await fakes.platformSettingRepository.set("tripRules", { maxTripDays: 5 });

  const overtime = await service.getRulesForType("overtime");
  assert.equal(overtime.maxHoursPerDay, 8);
  assert.equal(overtime.advanceNoticeHours, 6);
  assert.equal(overtime.maxHoursPerWeek, OVERTIME_RULES_DEFAULTS.maxHoursPerWeek, "missing keys fall back");

  const trip = await service.getRulesForType("trip");
  assert.equal(trip.maxTripDays, 5);
  assert.equal(trip.advanceNoticeHours, TRIP_RULES_DEFAULTS.advanceNoticeHours);
});

test("business-rule getRulesForType rejects unsupported types", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.getRulesForType("leave"),
    (err) => err instanceof ValidationError && err.details.field === "type"
  );
});

/* ------------------------------------------------------------------ */
/* Enforcement                                                         */
/* ------------------------------------------------------------------ */

test("business-rule enforceForType rejects a violating overtime payload", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("overtimeRules", {
    maxHoursPerDay: 2,
    advanceNoticeHours: 0,
  });
  await assert.rejects(
    service.enforceForType("overtime", {
      date: daysFromNow(5),
      startTime: "09:00",
      endTime: "13:00",
    }),
    (err) => err instanceof ValidationError && err.details.field === "endTime"
  );
});

test("business-rule enforceForType rejects a violating trip payload", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("tripRules", {
    maxTripDays: 7,
    advanceNoticeHours: 0,
  });
  await assert.rejects(
    service.enforceForType("trip", {
      startDate: daysFromNow(10),
      endDate: daysFromNow(20),
    }),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
});

test("business-rule enforceForType passes a valid payload and returns the derived value", async () => {
  const { service } = makeService();
  const result = await service.enforceForType("overtime", {
    date: daysFromNow(5),
    startTime: "09:00",
    endTime: "11:00",
  });
  assert.equal(result.hours, 2);
});

/* ------------------------------------------------------------------ */
/* OvertimeService / TripService wiring (FR-046 hook)                  */
/* ------------------------------------------------------------------ */

test("overtime submit enforces business rules before delegating", async () => {
  const fakes = buildFakes();
  await fakes.platformSettingRepository.set("overtimeRules", {
    earliestStartHour: 8,
    advanceNoticeHours: 0,
  });
  const { calls, overtimeService } = makeThinWrappers(fakes);

  await assert.rejects(
    overtimeService.submit({
      requesterId: "u_emp",
      input: { date: daysFromNow(5), startTime: "06:00", endTime: "07:00", reason: "early" },
      actor: {},
    }),
    (err) => err instanceof ValidationError && err.details.field === "startTime"
  );
  assert.equal(calls.length, 0, "submitRequest not reached when rules are violated");

  const result = await overtimeService.submit({
    requesterId: "u_emp",
    input: { date: daysFromNow(5), startTime: "10:00", endTime: "12:00", reason: "ops" },
    actor: {},
  });
  assert.equal(result.type, "OVERTIME");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "OVERTIME");
});

test("trip submit enforces business rules before delegating", async () => {
  const fakes = buildFakes();
  await fakes.platformSettingRepository.set("tripRules", {
    maxTripDays: 3,
    advanceNoticeHours: 0,
  });
  const { calls, tripService } = makeThinWrappers(fakes);

  await assert.rejects(
    tripService.submit({
      requesterId: "u_emp",
      input: { destination: "NYC", startDate: daysFromNow(10), endDate: daysFromNow(15), purpose: "conf" },
      actor: {},
    }),
    (err) => err instanceof ValidationError && err.details.field === "endDate"
  );
  assert.equal(calls.length, 0);

  const result = await tripService.submit({
    requesterId: "u_emp",
    input: { destination: "NYC", startDate: daysFromNow(10), endDate: daysFromNow(11), purpose: "conf" },
    actor: {},
  });
  assert.equal(result.type, "TRIP");
  assert.equal(calls.length, 1);
});

test("overtime submit behaves exactly as before when businessRuleService is absent", async () => {
  const calls = [];
  const requestService = {
    submitRequest: async (input) => {
      calls.push(input);
      return { id: "req_1", type: input.type, status: "PENDING" };
    },
  };
  const overtimeService = new OvertimeService({
    requestService,
    pendingSummaryService: { registerProvider: () => {} },
  });

  const result = await overtimeService.submit({
    requesterId: "u_emp",
    input: { date: daysFromNow(1), startTime: "23:00", endTime: "23:59", reason: "late", hours: 1 },
    actor: {},
  });
  assert.equal(result.status, "PENDING");
  assert.equal(calls.length, 1);
});

test("trip submit behaves exactly as before when businessRuleService is absent", async () => {
  const calls = [];
  const requestService = {
    submitRequest: async (input) => {
      calls.push(input);
      return { id: "req_1", type: input.type, status: "PENDING" };
    },
  };
  const tripService = new TripService({
    requestService,
    pendingSummaryService: { registerProvider: () => {} },
  });

  const result = await tripService.submit({
    requesterId: "u_emp",
    input: { destination: "Paris", startDate: daysFromNow(1), endDate: daysFromNow(2), purpose: "site" },
    actor: {},
  });
  assert.equal(result.type, "TRIP");
  assert.equal(calls.length, 1);
});
