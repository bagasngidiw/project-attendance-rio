/**
 * PendingSummaryService unit tests (FR-006): provider registration and
 * aggregation across HR modules, with stable zero-counts for unregistered
 * modules and extensibility for future request modules (FR-027).
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { ValidationError } = require("../../src/domain/errors");

let service;

beforeEach(() => {
  service = new PendingSummaryService();
});

test("empty registry returns zero counts for every module", async () => {
  const summary = await service.getPendingSummary(["u_1", "u_2"]);
  assert.deepEqual(summary, {
    attendance: 0,
    leave: 0,
    overtime: 0,
    trip: 0,
    permission: 0,
    sakit: 0,
  });
});

test("registered providers contribute counts per module", async () => {
  service.registerProvider({
    module: "leave",
    countPendingForUserIds: async () => 4,
  });
  service.registerProvider({
    module: "trip",
    countPendingForUserIds: async () => 2,
  });

  const summary = await service.getPendingSummary(["u_1"]);
  assert.deepEqual(summary, {
    attendance: 0,
    leave: 4,
    overtime: 0,
    trip: 2,
    permission: 0,
    sakit: 0,
  });
});

test("providers are called with the deduplicated user id set", async () => {
  const received = [];
  service.registerProvider({
    module: "overtime",
    countPendingForUserIds: async (userIds) => {
      received.push(userIds);
      return userIds.length;
    },
  });

  const summary = await service.getPendingSummary(["u_1", "u_2", "u_1"]);
  assert.deepEqual(received, [["u_1", "u_2"]]);
  assert.equal(summary.overtime, 2);
});

test("non-finite provider results are coerced to zero", async () => {
  service.registerProvider({
    module: "leave",
    countPendingForUserIds: async () => null,
  });
  const summary = await service.getPendingSummary(["u_1"]);
  assert.equal(summary.leave, 0);
});

test("registering an unknown module is rejected", () => {
  assert.throws(
    () => service.registerProvider({ module: "payroll", countPendingForUserIds: async () => 0 }),
    ValidationError
  );
});

test("registering a provider without a count function is rejected", () => {
  assert.throws(
    () => service.registerProvider({ module: "leave" }),
    ValidationError
  );
});

test("registering the same module twice keeps the latest provider", async () => {
  service.registerProvider({ module: "leave", countPendingForUserIds: async () => 1 });
  service.registerProvider({ module: "leave", countPendingForUserIds: async () => 7 });
  const summary = await service.getPendingSummary(["u_1"]);
  assert.equal(summary.leave, 7);
});
