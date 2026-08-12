/**
 * EscalationService tests (FR-009) — threshold sweep, ESCALATION.TRIGGERED
 * audit, request.escalated event, and config read/update — against in-memory
 * fakes (no MongoDB).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { EscalationService } = require("../../src/application/escalation.service");
const { ValidationError } = require("../../src/domain/errors");

const NOW = new Date("2026-09-10T00:00:00Z");

function makeServices() {
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
  const eventBus = new EventBus();
  const escalationService = new EscalationService({
    platformSettingRepository: fakes.platformSettingRepository,
    requestRepository: fakes.requestRepository,
    auditService,
    eventBus,
  });
  return { fakes, escalationService, eventBus };
}

/** Seeds a PENDING request with an explicit submission date. */
async function seedPendingRequest(fakes, { submittedAt, type = "LEAVE", approverId = "u_mgr" }) {
  const req = await fakes.requestRepository.create({
    type,
    requesterId: "u_emp",
    payload: {},
    status: "PENDING",
  });
  const stored = fakes.requestRepository.requests.get(req.id);
  stored.approverId = approverId;
  stored.submittedAt = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  return stored;
}

test("escalation: getConfig returns defaults when escalationConfig is unset", async () => {
  const { escalationService } = makeServices();
  const config = await escalationService.getConfig();
  assert.deepEqual(config, { maxPendingDays: 3, notifyApprover: true });
});

test("escalation: getConfig reads a stored config", async () => {
  const { fakes, escalationService } = makeServices();
  await fakes.platformSettingRepository.set("escalationConfig", {
    maxPendingDays: 5,
    notifyApprover: false,
  });
  const config = await escalationService.getConfig();
  assert.deepEqual(config, { maxPendingDays: 5, notifyApprover: false });
});

test("escalation: checkPendingRequests escalates stale requests with audit + event", async () => {
  const { fakes, escalationService, eventBus } = makeServices();
  const published = [];
  eventBus.subscribe("request.escalated", (payload) => published.push(payload));

  await seedPendingRequest(fakes, { submittedAt: "2026-09-01T00:00:00Z" }); // 9 days
  await seedPendingRequest(fakes, { submittedAt: "2026-08-20T00:00:00Z", type: "OVERTIME" }); // 21 days
  await seedPendingRequest(fakes, { submittedAt: "2026-09-09T00:00:00Z" }); // recent, skipped

  const result = await escalationService.checkPendingRequests(NOW);

  assert.equal(result.count, 2);
  assert.equal(result.items[0].daysPending, 9);
  assert.equal(result.items[1].daysPending, 21);

  const audits = fakes.auditRepository.entries.filter((e) => e.action === "ESCALATION.TRIGGERED");
  assert.equal(audits.length, 2, "one ESCALATION.TRIGGERED per stale request");
  assert.equal(audits[0].metadata.requestId, result.items[0].requestId);
  assert.equal(audits[0].metadata.type, "LEAVE");
  assert.equal(audits[0].metadata.requesterId, "u_emp");
  assert.equal(audits[0].metadata.daysPending, 9);

  assert.equal(published.length, 2, "request.escalated published per stale request");
  assert.equal(published[0].approverId, "u_mgr");
  assert.equal(published[1].type, "OVERTIME");
});

test("escalation: checkPendingRequests skips requests inside the threshold", async () => {
  const { fakes, escalationService, eventBus } = makeServices();
  const published = [];
  eventBus.subscribe("request.escalated", (payload) => published.push(payload));

  await seedPendingRequest(fakes, { submittedAt: "2026-09-08T00:00:00Z" }); // 2 days < 3

  const result = await escalationService.checkPendingRequests(NOW);
  assert.equal(result.count, 0);
  assert.ok(!fakes.auditRepository.entries.some((e) => e.action === "ESCALATION.TRIGGERED"));
  assert.equal(published.length, 0);
});

test("escalation: checkPendingRequests honors maxPendingDays from config", async () => {
  const { fakes, escalationService } = makeServices();
  await fakes.platformSettingRepository.set("escalationConfig", { maxPendingDays: 10, notifyApprover: true });

  await seedPendingRequest(fakes, { submittedAt: "2026-09-01T00:00:00Z" }); // 9 days < 10

  const result = await escalationService.checkPendingRequests(NOW);
  assert.equal(result.count, 0);
});

test("escalation: checkPendingRequests audits but suppresses the event when notifyApprover is false", async () => {
  const { fakes, escalationService, eventBus } = makeServices();
  const published = [];
  eventBus.subscribe("request.escalated", (payload) => published.push(payload));
  await fakes.platformSettingRepository.set("escalationConfig", { maxPendingDays: 3, notifyApprover: false });

  await seedPendingRequest(fakes, { submittedAt: "2026-09-01T00:00:00Z" });

  const result = await escalationService.checkPendingRequests(NOW);
  assert.equal(result.count, 1);
  const audits = fakes.auditRepository.entries.filter((e) => e.action === "ESCALATION.TRIGGERED");
  assert.equal(audits.length, 1, "audit still recorded");
  assert.equal(published.length, 0, "no event when notifyApprover is off");
});

test("escalation: checkPendingRequests returns empty when nothing is pending", async () => {
  const { fakes, escalationService } = makeServices();
  const result = await escalationService.checkPendingRequests(NOW);
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
});

test("escalation: updateConfig persists the config and audits SETTINGS.CHANGED", async () => {
  const { fakes, escalationService } = makeServices();
  const actor = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"], correlationId: "corr_cfg" };

  const result = await escalationService.updateConfig(
    { maxPendingDays: 7, notifyApprover: false },
    actor
  );

  assert.deepEqual(result, { key: "escalationConfig", value: { maxPendingDays: 7, notifyApprover: false } });
  const stored = await fakes.platformSettingRepository.get("escalationConfig");
  assert.deepEqual(stored, { maxPendingDays: 7, notifyApprover: false });

  const audit = fakes.auditRepository.entries.find((e) => e.action === "SETTINGS.CHANGED");
  assert.ok(audit, "SETTINGS.CHANGED audit recorded");
  assert.equal(audit.metadata.setting, "escalationConfig");
  assert.deepEqual(audit.metadata.newValue, { maxPendingDays: 7, notifyApprover: false });
  assert.equal(audit.actor.userId, "u_admin");
});

test("escalation: updateConfig rejects invalid config shapes", async () => {
  const { escalationService } = makeServices();
  const actor = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

  await assert.rejects(
    escalationService.updateConfig({ maxPendingDays: 0 }, actor),
    (err) => err instanceof ValidationError && err.details.field === "maxPendingDays"
  );
  await assert.rejects(
    escalationService.updateConfig({ maxPendingDays: 2.5 }, actor),
    (err) => err instanceof ValidationError && err.details.field === "maxPendingDays"
  );
  await assert.rejects(
    escalationService.updateConfig({ maxPendingDays: 3, notifyApprover: "yes" }, actor),
    (err) => err instanceof ValidationError && err.details.field === "notifyApprover"
  );
  await assert.rejects(
    escalationService.updateConfig("not-an-object", actor),
    (err) => err instanceof ValidationError && err.details.field === "escalationConfig"
  );
});
