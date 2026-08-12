/**
 * PersonalDataService tests (FR-048): bundle assembly for an existing user
 * (mapped to plain DTOs, never internal fields), PERSONAL_DATA.EXPORTED audit
 * with record counts, and NotFoundError for unknown users.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { PersonalDataService } = require("../../src/application/personal-data.service");
const { NotFoundError } = require("../../src/domain/errors");

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
  const service = new PersonalDataService({
    userRepository: fakes.userRepository,
    requestRepository: fakes.requestRepository,
    attendanceRepository: fakes.attendanceRepository,
    notificationRepository: fakes.notificationRepository,
    auditRepository: fakes.auditRepository,
    auditService,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
  });
  return { service, fakes };
}

const ACTOR = {
  actorId: "u_admin",
  actorRoleKeys: ["HR_COMPLIANCE"],
  ip: "1.2.3.4",
  userAgent: "test",
  correlationId: "corr_1",
};

function seed(fakes) {
  fakes.userRepository.seed({
    id: "u_emp",
    username: "jane",
    email: "jane@corp.io",
    name: "Jane",
    status: "ACTIVE",
    departmentId: "dept_1",
    positionId: "pos_1",
    passwordHash: "hash-abc",
  });
  const role = fakes.roleRepository.seed({ id: "r_1", key: "EMPLOYEE", name: "Employee" });
  fakes.userRoleRepository.assign("u_emp", [role.id]);
}

test("exportForUser assembles a bundle for an existing user (no internal fields)", async () => {
  const { service, fakes } = makeService();
  seed(fakes);

  await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveType: "ANNUAL" },
    status: "APPROVED",
  });
  await fakes.attendanceRepository.create({
    userId: "u_emp",
    date: "2026-01-05",
    clockInAt: "09:00",
    status: "NORMAL",
  });
  await fakes.notificationRepository.create({
    userId: "u_emp",
    type: "request.decided",
    title: "Decided",
    body: "ok",
  });

  const result = await service.exportForUser({ userId: "u_emp", actor: ACTOR });
  const { bundle } = result;

  assert.deepEqual(bundle.profile, {
    id: "u_emp",
    username: "jane",
    email: "jane@corp.io",
    name: "Jane",
    departmentId: "dept_1",
    positionId: "pos_1",
  });
  assert.equal("passwordHash" in bundle.profile, false);
  assert.equal("tokenVersion" in bundle.profile, false);

  assert.deepEqual(bundle.roles, [{ id: "r_1", key: "EMPLOYEE", name: "Employee" }]);

  assert.equal(bundle.requests.length, 1);
  assert.equal(bundle.requests[0].type, "LEAVE");
  assert.equal(bundle.requests[0].status, "APPROVED");
  assert.deepEqual(bundle.requests[0].payload, { leaveType: "ANNUAL" });

  assert.equal(bundle.attendance.length, 1);
  assert.equal(bundle.attendance[0].date, "2026-01-05");
  assert.equal(bundle.attendance[0].clockInAt, "09:00");

  assert.equal(bundle.notifications.length, 1);
  assert.equal(bundle.notifications[0].type, "request.decided");

  assert.ok(bundle.exportedAt, "exportedAt present");
  assert.ok(typeof result.json === "function");
  const json = result.json();
  assert.ok(json.includes('"username": "jane"'));
  assert.ok(json.includes('"email": "jane@corp.io"'));
});

test("exportForUser audits PERSONAL_DATA.EXPORTED with record counts", async () => {
  const { service, fakes } = makeService();
  seed(fakes);
  await fakes.requestRepository.create({
    type: "OVERTIME",
    requesterId: "u_emp",
    payload: {},
    status: "PENDING",
  });

  await service.exportForUser({ userId: "u_emp", actor: ACTOR });

  const audit = fakes.auditRepository.entries.find(
    (e) => e.action === "PERSONAL_DATA.EXPORTED"
  );
  assert.ok(audit, "PERSONAL_DATA.EXPORTED recorded");
  assert.equal(audit.actor.userId, "u_admin");
  assert.equal(audit.actor.roleKeys[0], "HR_COMPLIANCE");
  assert.equal(audit.subject.type, "USER");
  assert.equal(audit.subject.id, "u_emp");
  assert.equal(audit.metadata.targetUserId, "u_emp");
  assert.deepEqual(audit.metadata.recordCounts, {
    roles: 1,
    requests: 1,
    attendance: 0,
    notifications: 0,
  });
});

test("exportForUser rejects unknown users with NotFoundError", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.exportForUser({ userId: "u_missing", actor: ACTOR }),
    (err) => err instanceof NotFoundError && err.code === "USER_NOT_FOUND"
  );
});

test("exportForUser handles a user with no roles or records", async () => {
  const { service, fakes } = makeService();
  fakes.userRepository.seed({
    id: "u_new",
    username: "new",
    email: "new@corp.io",
    name: "New",
    status: "ACTIVE",
  });

  const { bundle } = await service.exportForUser({ userId: "u_new", actor: ACTOR });
  assert.deepEqual(bundle.roles, []);
  assert.deepEqual(bundle.requests, []);
  assert.deepEqual(bundle.attendance, []);
  assert.deepEqual(bundle.notifications, []);
  assert.equal(bundle.profile.username, "new");
});
