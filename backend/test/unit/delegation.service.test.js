/**
 * DelegationService tests (FR-009) — create/revoke/list/effective-approver
 * resolution plus audit recording, against in-memory fakes (no MongoDB).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { DelegationService } = require("../../src/application/delegation.service");
const { ValidationError, NotFoundError, ConflictError } = require("../../src/domain/errors");

/** In-memory port matching the DelegationRepository interface. */
class InMemoryDelegationRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create({ delegatorId, delegateId, requestTypes = [], startsAt, endsAt }) {
    const entry = {
      id: `del_${this.nextId++}`,
      delegatorId: String(delegatorId),
      delegateId: String(delegateId),
      requestTypes,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: "ACTIVE",
      revokedAt: null,
      revokedBy: null,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findById(id) {
    return this.entries.find((e) => e.id === String(id)) ?? null;
  }

  async findByDelegator(delegatorId) {
    return this.entries
      .filter((e) => e.delegatorId === String(delegatorId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async findByDelegate(delegateId) {
    return this.entries.filter((e) => e.delegateId === String(delegateId));
  }

  async findActiveForDelegator(delegatorId, date) {
    const d = new Date(date);
    return this.entries.filter(
      (e) =>
        e.delegatorId === String(delegatorId) &&
        e.status === "ACTIVE" &&
        new Date(e.startsAt) <= d &&
        new Date(e.endsAt) >= d
    );
  }

  async revoke(id, { revokedBy }) {
    const entry = this.entries.find((e) => e.id === String(id) && e.status === "ACTIVE");
    if (!entry) return null;
    entry.status = "REVOKED";
    entry.revokedAt = new Date();
    entry.revokedBy = String(revokedBy);
    return entry;
  }

  async listActive() {
    return this.entries.filter((e) => e.status === "ACTIVE");
  }
}

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
  const delegationRepository = new InMemoryDelegationRepository();
  const delegationService = new DelegationService({
    delegationRepository,
    userRepository: fakes.userRepository,
    auditService,
  });
  return { fakes, auditService, delegationRepository, delegationService };
}

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_delegate", username: "del", email: "del@corp.io", name: "Del", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_inactive", username: "off", email: "off@corp.io", name: "Off", status: "INACTIVE" });
}

const VALID_INPUT = {
  delegateId: "u_delegate",
  requestTypes: [],
  startsAt: "2026-09-01",
  endsAt: "2026-09-30",
};

const ACTOR = {
  actorId: "u_mgr",
  actorRoleKeys: ["MANAGER"],
  correlationId: "corr_del",
  ip: "127.0.0.1",
  userAgent: "unit",
};

test("delegation service: createDelegation persists and audits DELEGATION.CREATED", async () => {
  const { fakes, delegationRepository, delegationService } = makeServices();
  seedUsers(fakes);

  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: VALID_INPUT,
    actor: ACTOR,
  });

  assert.equal(created.status, "ACTIVE");
  assert.equal(created.delegatorId, "u_mgr");
  assert.equal(created.delegateId, "u_delegate");
  assert.equal(delegationRepository.entries.length, 1);

  const audit = fakes.auditRepository.entries.find((e) => e.action === "DELEGATION.CREATED");
  assert.ok(audit, "DELEGATION.CREATED audit recorded");
  assert.equal(audit.subject.id, created.id);
  assert.equal(audit.actor.userId, "u_mgr");
  assert.equal(audit.metadata.delegateId, "u_delegate");
});

test("delegation service: createDelegation rejects self-delegation", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await assert.rejects(
    delegationService.createDelegation({
      delegatorId: "u_mgr",
      input: { ...VALID_INPUT, delegateId: "u_mgr" },
      actor: ACTOR,
    }),
    (err) => err instanceof ValidationError && err.details.field === "delegateId"
  );
});

test("delegation service: createDelegation rejects an inactive delegate", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await assert.rejects(
    delegationService.createDelegation({
      delegatorId: "u_mgr",
      input: { ...VALID_INPUT, delegateId: "u_inactive" },
      actor: ACTOR,
    }),
    (err) => err instanceof ValidationError && err.details.field === "delegateId"
  );
});

test("delegation service: createDelegation rejects inverted dates", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await assert.rejects(
    delegationService.createDelegation({
      delegatorId: "u_mgr",
      input: { ...VALID_INPUT, startsAt: "2026-09-30", endsAt: "2026-09-01" },
      actor: ACTOR,
    }),
    (err) => err instanceof ValidationError && err.details.field === "endsAt"
  );
});

test("delegation service: revokeDelegation by the owner soft-revokes and audits DELEGATION.REVOKED", async () => {
  const { fakes, delegationRepository, delegationService } = makeServices();
  seedUsers(fakes);

  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: VALID_INPUT,
    actor: ACTOR,
  });

  const revoked = await delegationService.revokeDelegation({
    id: created.id,
    delegatorId: "u_mgr",
    actor: ACTOR,
  });

  assert.equal(revoked.status, "REVOKED");
  assert.equal(revoked.revokedBy, "u_mgr");
  assert.ok(revoked.revokedAt);
  assert.equal((await delegationRepository.findById(created.id)).status, "REVOKED");

  const audit = fakes.auditRepository.entries.find((e) => e.action === "DELEGATION.REVOKED");
  assert.ok(audit, "DELEGATION.REVOKED audit recorded");
  assert.equal(audit.subject.id, created.id);
  assert.equal(audit.metadata.revokedBy, "u_mgr");
});

test("delegation service: revokeDelegation by a non-owner gets 404 and no audit", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: VALID_INPUT,
    actor: ACTOR,
  });

  await assert.rejects(
    delegationService.revokeDelegation({ id: created.id, delegatorId: "u_other", actor: ACTOR }),
    (err) => err instanceof NotFoundError && err.code === "DELEGATION_NOT_FOUND"
  );
  assert.ok(
    !fakes.auditRepository.entries.some((e) => e.action === "DELEGATION.REVOKED"),
    "no revoke audit for non-owner"
  );
});

test("delegation service: revokeDelegation of a missing delegation gets 404", async () => {
  const { delegationService } = makeServices();
  await assert.rejects(
    delegationService.revokeDelegation({ id: "del_missing", delegatorId: "u_mgr", actor: ACTOR }),
    NotFoundError
  );
});

test("delegation service: revoking an already-revoked delegation conflicts", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);
  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: VALID_INPUT,
    actor: ACTOR,
  });
  await delegationService.revokeDelegation({ id: created.id, delegatorId: "u_mgr", actor: ACTOR });

  await assert.rejects(
    delegationService.revokeDelegation({ id: created.id, delegatorId: "u_mgr", actor: ACTOR }),
    (err) => err instanceof ConflictError && err.code === "DELEGATION_ALREADY_REVOKED"
  );
});

test("delegation service: listMyDelegations returns only the delegator's records", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await delegationService.createDelegation({ delegatorId: "u_mgr", input: VALID_INPUT, actor: ACTOR });
  await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: { ...VALID_INPUT, requestTypes: ["overtime"] },
    actor: ACTOR,
  });
  await delegationService.createDelegation({
    delegatorId: "u_delegate",
    input: { ...VALID_INPUT, delegateId: "u_mgr" },
    actor: { ...ACTOR, actorId: "u_delegate" },
  });

  const { items, total } = await delegationService.listMyDelegations("u_mgr");
  assert.equal(total, 2);
  assert.ok(items.every((d) => d.delegatorId === "u_mgr"));
});

test("delegation service: resolveEffectiveApprover returns the delegate when an active delegation covers", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: { ...VALID_INPUT, requestTypes: ["leave"] },
    actor: ACTOR,
  });

  const result = await delegationService.resolveEffectiveApprover({
    approverId: "u_mgr",
    requestType: "LEAVE",
    date: "2026-09-10",
  });
  assert.deepEqual(result, {
    effectiveApproverId: "u_delegate",
    delegated: true,
    delegationId: created.id,
  });
});

test("delegation service: resolveEffectiveApprover returns approverId unchanged when no active delegation", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: { ...VALID_INPUT, startsAt: "2026-01-01", endsAt: "2026-01-31" },
    actor: ACTOR,
  });

  const result = await delegationService.resolveEffectiveApprover({
    approverId: "u_mgr",
    requestType: "LEAVE",
    date: "2026-09-10",
  });
  assert.deepEqual(result, { effectiveApproverId: "u_mgr", delegated: false, delegationId: null });
});

test("delegation service: resolveEffectiveApprover honors request-type filtering", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: { ...VALID_INPUT, requestTypes: ["leave"] },
    actor: ACTOR,
  });

  const result = await delegationService.resolveEffectiveApprover({
    approverId: "u_mgr",
    requestType: "OVERTIME",
    date: "2026-09-10",
  });
  assert.equal(result.delegated, false);
  assert.equal(result.effectiveApproverId, "u_mgr");
});

test("delegation service: resolveEffectiveApprover ignores revoked delegations", async () => {
  const { fakes, delegationService } = makeServices();
  seedUsers(fakes);

  const created = await delegationService.createDelegation({
    delegatorId: "u_mgr",
    input: VALID_INPUT,
    actor: ACTOR,
  });
  await delegationService.revokeDelegation({ id: created.id, delegatorId: "u_mgr", actor: ACTOR });

  const result = await delegationService.resolveEffectiveApprover({
    approverId: "u_mgr",
    requestType: "leave",
    date: "2026-09-10",
  });
  assert.equal(result.delegated, false);
});
