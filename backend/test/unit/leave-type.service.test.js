/**
 * LeaveTypeService tests (FR-058): CRUD, duplicate rejection, deactivation,
 * registration checks, and audited changes.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { LeaveTypeService } = require("../../src/application/leave-type.service");
const { ConflictError, NotFoundError, ValidationError } = require("../../src/domain/errors");

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
  const service = new LeaveTypeService({
    leaveTypeRepository: fakes.leaveTypeRepository,
    auditService,
  });
  return { service, fakes };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

test("create validates, persists, and audits (D15)", async () => {
  const { service, fakes } = makeService();
  const type = await service.create(
    { key: "MATERNITY", name: "Maternity Leave", isBalanceBased: true, maxDaysPerRequest: 90 },
    ACTOR
  );
  assert.equal(type.key, "MATERNITY");
  assert.equal(type.name, "Maternity Leave");
  assert.equal(type.isBalanceBased, true);
  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "SETTINGS.CHANGED"));
});

test("duplicate keys and invalid input are rejected", async () => {
  const { service } = makeService();
  await service.create({ key: "MATERNITY", name: "Maternity" }, ACTOR);
  await assert.rejects(
    service.create({ key: "MATERNITY", name: "Maternity 2" }, ACTOR),
    (err) => err instanceof ConflictError && err.code === "LEAVE_TYPE_EXISTS"
  );
  await assert.rejects(
    service.create({ key: "bad key", name: "Bad" }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "key"
  );
  await assert.rejects(
    service.create({ key: "ANNUAL", name: "Annual", maxDaysPerRequest: -1 }, ACTOR),
    ValidationError
  );
});

test("deactivation preserves the record and excludes it from active list", async () => {
  const { service, fakes } = makeService();
  const type = await service.create({ key: "PATERNITY", name: "Paternity" }, ACTOR);

  const deactivated = await service.deactivate(type.id, ACTOR);
  assert.equal(deactivated.status, "INACTIVE");

  const active = await service.listActive();
  assert.ok(!active.some((t) => t.key === "PATERNITY"), "hidden from the form");

  const all = await service.listAll();
  assert.ok(all.some((t) => t.key === "PATERNITY"), "history preserved");

  await service.activate(type.id, ACTOR);
  assert.ok((await service.listActive()).some((t) => t.key === "PATERNITY"));
});

test("isActiveType gates submissions to registered active types", async () => {
  const { service } = makeService();
  await service.create({ key: "MATERNITY", name: "Maternity" }, ACTOR);

  assert.equal(await service.isActiveType("MATERNITY"), true);
  assert.equal(await service.isActiveType("UNKNOWN"), false);

  await service.deactivate((await service.listAll()).find((t) => t.key === "MATERNITY").id, ACTOR);
  assert.equal(await service.isActiveType("MATERNITY"), false, "deactivated types are not submittable");
});
