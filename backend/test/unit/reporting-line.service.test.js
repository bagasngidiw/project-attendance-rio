/**
 * ReportingLineService tests (FR-043): manager assignment (self-blocked,
 * ACTIVE manager required, history + audit), direct reports, and history.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { ReportingLineService } = require("../../src/application/reporting-line.service");
const { NotFoundError, ConflictError, ValidationError } = require("../../src/domain/errors");

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
  const service = new ReportingLineService({
    userRepository: fakes.userRepository,
    reportingRepository: fakes.reportingRepository,
    auditService,
  });
  return { service, fakes, auditService };
}

function seed(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Jane", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
  fakes.userRepository.seed({ id: "u_inactive", username: "gone", email: "gone@corp.io", name: "Gone", status: "INACTIVE", managerId: null });
}

test("assignManager sets the reporting line, appends history, and audits (F2)", async () => {
  const { service, fakes } = makeService();
  seed(fakes);

  const result = await service.assignManager("u_emp", { managerId: "u_mgr" }, { actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] });

  assert.equal(result.managerId, "u_mgr");
  assert.equal(fakes.userRepository.users.get("u_emp").managerId, "u_mgr");

  const history = await service.getManagerHistory("u_emp");
  assert.equal(history.length, 1);
  assert.equal(history[0].oldManagerId, null);
  assert.equal(history[0].newManagerId, "u_mgr");

  assert.ok(fakes.auditRepository.entries.some((e) => e.action === "REPORTING.MANAGER_ASSIGNED"));
});

test("assignManager blocks self-management (F2)", async () => {
  const { service, fakes } = makeService();
  seed(fakes);
  await assert.rejects(
    service.assignManager("u_emp", { managerId: "u_emp" }, {}),
    (err) => err instanceof ValidationError && err.details.field === "managerId"
  );
});

test("assignManager requires an ACTIVE manager", async () => {
  const { service, fakes } = makeService();
  seed(fakes);
  await assert.rejects(
    service.assignManager("u_emp", { managerId: "u_inactive" }, {}),
    (err) => err instanceof ConflictError && err.code === "INVALID_MANAGER"
  );
  await assert.rejects(
    service.assignManager("u_emp", { managerId: "u_ghost" }, {}),
    NotFoundError
  );
});

test("assigning the same manager is a no-op without a new history entry", async () => {
  const { service, fakes } = makeService();
  seed(fakes);
  await service.assignManager("u_emp", { managerId: "u_mgr" }, {});
  const result = await service.assignManager("u_emp", { managerId: "u_mgr" }, {});
  assert.equal(result.unchanged, true);
  assert.equal((await service.getManagerHistory("u_emp")).length, 1, "no duplicate history");
});

test("getDirectReports returns only ACTIVE direct reports (F3)", async () => {
  const { service, fakes } = makeService();
  seed(fakes);
  fakes.userRepository.users.get("u_emp").managerId = "u_mgr";
  fakes.userRepository.seed({ id: "u_emp2", username: "emp2", email: "emp2@corp.io", name: "Other", status: "ACTIVE", managerId: "u_mgr" });

  const reports = await service.getDirectReports("u_mgr");
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.managerId === "u_mgr"));
});
