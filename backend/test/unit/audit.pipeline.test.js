/**
 * Audit pipeline unit tests: publisher classification/scrubbing through the
 * in-memory fakes, AuditService query + export, and chain verification.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");

function makeService() {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const service = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  return { service, fakes };
}

test("publish routes AUDIT-only events to audit surface", async () => {
  const { service, fakes } = makeService();
  await service.record({
    action: "AUTH.SIGNIN_SUCCESS",
    actor: { userId: "u_1", roleKeys: ["EMPLOYEE"] },
    subject: { type: "USER", id: "u_1" },
    outcome: "SUCCESS",
    correlationId: "corr_x",
  });

  assert.equal(fakes.auditRepository.entries.length, 1);
  assert.equal(fakes.activityRepository.entries.length, 0);
  const event = fakes.auditRepository.entries[0];
  assert.equal(event.action, "AUTH.SIGNIN_SUCCESS");
  assert.ok(event.hash, "audit event must be hash-chained");
});

test("publish routes BOTH events to audit and activity surfaces", async () => {
  const { service, fakes } = makeService();
  await service.record({
    action: "RBAC.ROLES_ASSIGNED",
    actor: { userId: "u_admin" },
    subject: { type: "USER", id: "u_target" },
    outcome: "SUCCESS",
  });

  assert.equal(fakes.auditRepository.entries.length, 1);
  assert.equal(fakes.activityRepository.entries.length, 1);
});

test("publish scrubs secrets from persisted metadata", async () => {
  const { service, fakes } = makeService();
  await service.record({
    action: "USER.PASSWORD_RESET",
    actor: { userId: "u_1" },
    outcome: "SUCCESS",
    metadata: { password: "hunter2", token: "abc", reason: "forgot" },
  });

  const event = fakes.auditRepository.entries[0];
  assert.deepEqual(event.metadata, { reason: "forgot" });
});

test("unknown event actions fail fast at record time", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.record({ action: "NOPE.NOT_REAL" }),
    /Unknown audit/
  );
});

test("audit events form a valid hash chain", async () => {
  const { service, fakes } = makeService();
  for (let i = 0; i < 5; i++) {
    await service.record({
      action: "AUTH.SIGNIN_SUCCESS",
      actor: { userId: "u_1" },
      outcome: "SUCCESS",
      metadata: { seq: i },
    });
  }

  const report = await fakes.auditRepository.verifyChain("test-salt");
  assert.deepEqual(report, { valid: true, firstBrokenIndex: null, count: 5 });

  // Tamper with the second event -> chain breaks at that entry.
  fakes.auditRepository.entries[1].hash = "tampered";
  const broken = await fakes.auditRepository.verifyChain("test-salt");
  assert.equal(broken.valid, false);
  assert.equal(broken.firstBrokenIndex, 1);
});

test("queryAuditEvents applies actor scope restriction", async () => {
  const { service } = makeService();
  await service.record({ action: "AUTH.SIGNIN_SUCCESS", actor: { userId: "u_1" }, outcome: "SUCCESS" });
  await service.record({ action: "AUTH.SIGNIN_SUCCESS", actor: { userId: "u_2" }, outcome: "SUCCESS" });
  await service.record({ action: "AUTH.DENIED", actor: { userId: "u_1" }, outcome: "DENIED" });

  const { items, total } = await service.queryAuditEvents(
    { page: 1, pageSize: 20 },
    { actorId: "u_1" }
  );
  assert.equal(total, 2);
  assert.ok(items.every((e) => e.actor.userId === "u_1"));
});

test("queryAuditEvents supports action + outcome filters", async () => {
  const { service } = makeService();
  await service.record({ action: "AUTH.SIGNIN_SUCCESS", actor: { userId: "u_1" }, outcome: "SUCCESS" });
  await service.record({ action: "AUTH.DENIED", actor: { userId: "u_1" }, outcome: "DENIED" });

  const { items, total } = await service.queryAuditEvents({
    action: "AUTH.DENIED",
    outcome: "DENIED",
    page: 1,
    pageSize: 20,
  });
  assert.equal(total, 1);
  assert.equal(items[0].action, "AUTH.DENIED");
});

test("getAuditEvent returns a single event by id", async () => {
  const { service, fakes } = makeService();
  await service.record({ action: "AUTH.SIGNOUT", actor: { userId: "u_1" }, outcome: "SUCCESS" });
  const event = fakes.auditRepository.entries[0];
  const found = await service.getAuditEvent(event.id);
  assert.equal(found.action, "AUTH.SIGNOUT");
});

test("verifyChain reports the chain health", async () => {
  const { service } = makeService();
  await service.record({ action: "AUTH.SIGNOUT", actor: { userId: "u_1" }, outcome: "SUCCESS" });
  const report = await service.verifyChain();
  assert.equal(report.valid, true);
  assert.equal(report.count, 1);
});

test("exportAuditEvents returns CSV with header + rows", async () => {
  const { service } = makeService();
  await service.record({
    action: "AUTH.DENIED",
    actor: { userId: "u_1" },
    subject: { type: "ROUTE", id: "/api/v1/x", summary: "users:create" },
    outcome: "DENIED",
  });

  const csv = await service.exportAuditEvents({ page: 1, pageSize: 100 });
  const lines = csv.trim().split("\n");
  assert.match(lines[0], /recordedAt/);
  assert.ok(lines[0].includes("action"));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes("AUTH.DENIED"));
});

test("activity records are queryable", async () => {
  const { service } = makeService();
  await service.record({ action: "REQUEST.APPROVED", actor: { userId: "u_2" }, outcome: "SUCCESS" });

  const { items, total } = await service.queryActivityRecords({
    page: 1,
    pageSize: 20,
  });
  assert.equal(total, 1);
  assert.equal(items[0].action, "REQUEST.APPROVED");
});
