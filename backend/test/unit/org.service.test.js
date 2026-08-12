/**
 * OrgService tests (FR-024): department/position CRUD, duplicate rejection,
 * deactivation preserving history, and audited lifecycle.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { OrgService } = require("../../src/application/org.service");
const { ConflictError, ValidationError } = require("../../src/domain/errors");

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
  const service = new OrgService({ orgRepository: fakes.orgRepository, auditService });
  return { service, fakes, auditService };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["HR_ADMIN"] };

test("createDepartment validates, persists, and audits (F1)", async () => {
  const { service, fakes } = makeService();
  const dept = await service.createDepartment(
    { name: "Engineering", code: "ENG", description: "Software" },
    ACTOR
  );
  assert.equal(dept.name, "Engineering");
  assert.equal(dept.code, "ENG");
  assert.equal(dept.status, "ACTIVE");

  assert.ok(
    fakes.auditRepository.entries.some((e) => e.action === "ORG.DEPARTMENT_CREATED")
  );
});

test("duplicate department and position names are rejected (F1)", async () => {
  const { service } = makeService();
  await service.createDepartment({ name: "Engineering" }, ACTOR);
  await assert.rejects(
    service.createDepartment({ name: "engineering " }, ACTOR),
    (err) => err instanceof ConflictError && err.code === "ORG_DUPLICATE"
  );

  await service.createPosition({ name: "Engineer" }, ACTOR);
  await assert.rejects(
    service.createPosition({ name: "Engineer" }, ACTOR),
    (err) => err instanceof ConflictError && err.code === "ORG_DUPLICATE"
  );
});

test("invalid names are rejected with 400", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.createDepartment({ name: "X" }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  await assert.rejects(
    service.createPosition({ name: "" }, ACTOR),
    ValidationError
  );
});

test("deactivation preserves the record; activation restores it (F1)", async () => {
  const { service, fakes } = makeService();
  const dept = await service.createDepartment({ name: "Finance" }, ACTOR);

  const deactivated = await service.deactivateDepartment(dept.id, ACTOR);
  assert.equal(deactivated.status, "INACTIVE");
  assert.equal(fakes.orgRepository.departments.get(dept.id).name, "Finance", "history preserved");

  assert.ok(
    fakes.auditRepository.entries.some((e) => e.action === "ORG.DEPARTMENT_DEACTIVATED")
  );

  const activeOnly = await service.listActiveDepartments();
  assert.ok(!activeOnly.some((d) => d.id === dept.id), "inactive excluded from pickers");

  const reactivated = await service.activateDepartment(dept.id, ACTOR);
  assert.equal(reactivated.status, "ACTIVE");
});

test("positions lifecycle records POSITION.* audit events", async () => {
  const { service, fakes } = makeService();
  const position = await service.createPosition({ name: "Designer", description: "UI" }, ACTOR);
  await service.updatePosition(position.id, { name: "Senior Designer" }, ACTOR);
  await service.deactivatePosition(position.id, ACTOR);
  await service.activatePosition(position.id, ACTOR);

  const actions = fakes.auditRepository.entries.map((e) => e.action);
  for (const expected of [
    "ORG.POSITION_CREATED",
    "ORG.POSITION_UPDATED",
    "ORG.POSITION_DEACTIVATED",
    "ORG.POSITION_ACTIVATED",
  ]) {
    assert.ok(actions.includes(expected), `missing ${expected}`);
  }
});
