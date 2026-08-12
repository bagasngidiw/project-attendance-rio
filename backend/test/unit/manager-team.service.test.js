/**
 * ManagerTeamService unit tests (FR-006): team overview resolution, scoped
 * member lookup (no existence leak), reporting-scope predicate, and audit
 * emission for team views.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { ManagerTeamService } = require("../../src/application/manager-team.service");
const { NotFoundError } = require("../../src/domain/errors");

let fakes;
let managerTeamService;

beforeEach(() => {
  fakes = buildFakes();

  fakes.roleRepository.seed({ id: "r_employee", key: "EMPLOYEE", name: "Employee" });
  fakes.roleRepository.seed({ id: "r_manager", key: "MANAGER", name: "Manager" });

  fakes.userRepository.seed({
    id: "u_mgr",
    username: "mgr",
    email: "mgr@corp.io",
    name: "The Manager",
    passwordHash: "x",
    managerId: null,
  });
  fakes.userRepository.seed({
    id: "u_emp1",
    username: "emp1",
    email: "emp1@corp.io",
    name: "Employee One",
    passwordHash: "x",
    managerId: "u_mgr",
  });
  fakes.userRepository.seed({
    id: "u_emp2",
    username: "emp2",
    email: "emp2@corp.io",
    name: "Employee Two",
    passwordHash: "x",
    managerId: "u_mgr",
  });
  fakes.userRepository.seed({
    id: "u_outside",
    username: "outside",
    email: "outside@corp.io",
    name: "Other Team",
    passwordHash: "x",
    managerId: "u_other_mgr",
  });

  fakes.userRoleRepository.assign("u_emp1", ["r_employee"]);
  fakes.userRoleRepository.assign("u_emp2", ["r_employee"]);
  fakes.userRoleRepository.assign("u_outside", ["r_employee"]);

  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
  });

  const pendingSummaryService = new PendingSummaryService();
  pendingSummaryService.registerProvider({
    module: "leave",
    countPendingForUserIds: async (userIds) => userIds.length * 2,
  });

  managerTeamService = new ManagerTeamService({
    userRepository: fakes.userRepository,
    userRoleRepository: fakes.userRoleRepository,
    roleRepository: fakes.roleRepository,
    pendingSummaryService,
    auditService,
  });
});

test("getTeamOverview returns only the manager's direct reports", async () => {
  const overview = await managerTeamService.getTeamOverview("u_mgr");

  assert.equal(overview.manager.username, "mgr");
  assert.equal(overview.memberCount, 2);
  const usernames = overview.members.map((m) => m.username).sort();
  assert.deepEqual(usernames, ["emp1", "emp2"]);
  assert.ok(!usernames.includes("outside"));

  const emp1 = overview.members.find((m) => m.username === "emp1");
  assert.deepEqual(emp1.roles, ["EMPLOYEE"]);
  assert.equal(emp1.managerId, "u_mgr");
});

test("getTeamOverview enriches members with role keys", async () => {
  const overview = await managerTeamService.getTeamOverview("u_mgr");
  const emp2 = overview.members.find((m) => m.username === "emp2");
  assert.deepEqual(emp2.roles, ["EMPLOYEE"]);
});

test("getTeamOverview aggregates pending summary across team members", async () => {
  const overview = await managerTeamService.getTeamOverview("u_mgr");
  // 2 team members, provider returns length * 2 = 4 for leave.
  assert.equal(overview.pendingSummary.leave, 4);
  assert.equal(overview.pendingSummary.attendance, 0);
  assert.equal(overview.pendingSummary.overtime, 0);
  assert.equal(overview.pendingSummary.trip, 0);
});

test("getTeamOverview records a TEAM.VIEWED activity event", async () => {
  await managerTeamService.getTeamOverview("u_mgr", {
    actorRoleKeys: ["MANAGER"],
    correlationId: "corr_1",
  });

  const activity = fakes.activityRepository.entries.find(
    (e) => e.action === "TEAM.VIEWED"
  );
  assert.ok(activity);
  assert.equal(activity.actor.userId, "u_mgr");
  assert.equal(activity.subject.type, "TEAM");
});

test("getTeamMember returns a scoped team member", async () => {
  const member = await managerTeamService.getTeamMember("u_mgr", "u_emp1");
  assert.equal(member.username, "emp1");
  assert.deepEqual(member.roles, ["EMPLOYEE"]);
});

test("getTeamMember rejects users outside the manager's scope (404, no leak)", async () => {
  await assert.rejects(
    managerTeamService.getTeamMember("u_mgr", "u_outside"),
    NotFoundError
  );
});

test("getTeamMember rejects unknown member ids", async () => {
  await assert.rejects(
    managerTeamService.getTeamMember("u_mgr", "u_does_not_exist"),
    NotFoundError
  );
});

test("getTeamMember rejects non-active members even when reporting line matches", async () => {
  fakes.userRepository.users.get("u_emp2").status = "INACTIVE";
  await assert.rejects(
    managerTeamService.getTeamMember("u_mgr", "u_emp2"),
    NotFoundError
  );
});

test("getTeamMember records a scoped TEAM.VIEWED activity event", async () => {
  await managerTeamService.getTeamMember("u_mgr", "u_emp1", {
    actorRoleKeys: ["MANAGER"],
  });
  const activity = fakes.activityRepository.entries.find(
    (e) => e.action === "TEAM.VIEWED" && e.subject.type === "USER"
  );
  assert.ok(activity);
  assert.equal(activity.subject.id, "u_emp1");
});

test("isWithinScope exposes the reporting-scope predicate", () => {
  assert.equal(managerTeamService.isWithinScope("u_mgr", "u_mgr"), true);
  assert.equal(managerTeamService.isWithinScope("u_other", "u_mgr"), false);
  assert.equal(managerTeamService.isWithinScope(null, "u_mgr"), false);
});

test("getTeamOverview rejects an unknown manager", async () => {
  await assert.rejects(
    managerTeamService.getTeamOverview("u_does_not_exist"),
    NotFoundError
  );
});
