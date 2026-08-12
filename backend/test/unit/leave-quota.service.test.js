/**
 * Leave quota (TODO.md FR-001/FR-002/FR-003) + submission balance validation
 * (FR-006): entitlement init on user create, entitlement edit with mandatory
 * reason + negative-remaining guard/override, audit, and 409 on over-balance
 * leave submissions.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { LeaveBalanceService } = require("../../src/application/leave-balance.service");
const { LeaveService } = require("../../src/application/leave.service");
const { PendingSummaryService } = require("../../src/application/pending-summary.service");
const { RequestService } = require("../../src/application/request.service");
const { UserAdminService } = require("../../src/application/user-admin.service");
const { LeaveTypeService } = require("../../src/application/leave-type.service");
const { ConflictError, ValidationError } = require("../../src/domain/errors");

/** Minimal in-memory leave-balance store matching the repository contract. */
function inMemoryLeaveBalanceRepository() {
  const rows = new Map();
  const key = (u, t, y) => `${u}|${t}|${y}`;
  return {
    async findByUserAndType(userId, leaveTypeId, year) {
      return rows.get(key(String(userId), String(leaveTypeId), year)) ?? null;
    },
    async listByUser(userId, year) {
      return [...rows.values()].filter((r) => String(r.userId) === String(userId) && r.year === year);
    },
    async listByUsers(userIds, year) {
      const set = new Set(userIds.map(String));
      return [...rows.values()].filter((r) => set.has(String(r.userId)) && r.year === year);
    },
    async upsert(userId, leaveTypeId, year, fields = {}) {
      const k = key(String(userId), String(leaveTypeId), year);
      const row = {
        id: `lb_${rows.size + 1}`,
        userId,
        leaveTypeId,
        year,
        entitlementDays: 0,
        adjustmentDays: 0,
        consumedDays: 0,
        reservedDays: 0,
        ...fields,
      };
      rows.set(k, row);
      return row;
    },
    async adjust(userId, leaveTypeId, year, { deltaEntitlement = 0, deltaAdjustment = 0, deltaConsumed = 0, deltaReserved = 0 } = {}) {
      const k = key(String(userId), String(leaveTypeId), year);
      const row = rows.get(k) ?? { id: `lb_${rows.size + 1}`, userId, leaveTypeId, year, entitlementDays: 0, adjustmentDays: 0, consumedDays: 0, reservedDays: 0 };
      row.entitlementDays += deltaEntitlement;
      row.adjustmentDays += deltaAdjustment;
      row.consumedDays += deltaConsumed;
      row.reservedDays += deltaReserved;
      rows.set(k, row);
      return row;
    },
  };
}

function makeServices() {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({ auditRepository: fakes.auditRepository, salt: "test-salt" });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const leaveTypeService = new LeaveTypeService({ leaveTypeRepository: fakes.leaveTypeRepository, auditService });
  const leaveBalanceRepository = inMemoryLeaveBalanceRepository();
  const leaveBalanceService = new LeaveBalanceService({
    leaveBalanceRepository,
    leaveTypeRepository: fakes.leaveTypeRepository,
    requestRepository: fakes.requestRepository,
    auditService,
  });
  const pendingSummaryService = new PendingSummaryService();
  const requestService = new RequestService({
    requestRepository: fakes.requestRepository,
    requestEventRepository: fakes.requestEventRepository,
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    auditService,
    leaveTypeService,
    sicknessTypeService: null,
    eventBus: { publish: async () => {} },
  });
  const leaveService = new LeaveService({
    requestService,
    pendingSummaryService,
    leaveTypeService,
    leaveBalanceService,
  });
  const userAdminService = new UserAdminService({
    userRepository: fakes.userRepository,
    roleRepository: fakes.roleRepository,
    userRoleRepository: fakes.userRoleRepository,
    passwordHasher: { hash: async (p) => `hash:${p}` },
    passwordService: { assertPasswordCompliant: async () => {} },
    auditService,
    leaveTypeRepository: fakes.leaveTypeRepository,
    leaveBalanceService,
  });
  return { fakes, leaveBalanceRepository, leaveTypeService, leaveBalanceService, leaveService, userAdminService, auditService };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"], actorPermissions: ["users:create", "users:edit"] };

test("FR-001: creating a user with jatahCuti initializes entitlement + mirror for balance-based types", async () => {
  const { fakes, leaveBalanceRepository, leaveTypeService, userAdminService } = makeServices();
  // ANNUAL is balance-based (isBalanceBased true) in the system seed.
  const annual = await leaveTypeService.create({ key: "ANNUAL", name: "Annual Leave", isBalanceBased: true }, ACTOR);
  await leaveTypeService.create({ key: "MATERNITY", name: "Maternity Leave", isBalanceBased: false }, ACTOR);
  const role = fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });

  const user = await userAdminService.createUser({
    username: "emp.quota",
    email: "emp.quota@corp.io",
    name: "Emp Quota",
    roleIds: [role.id],
    initialPassword: "QuotaPass2026!",
    jatahCuti: 12,
  }, ACTOR);

  const balances = await leaveBalanceRepository.listByUser(user.id, new Date().getUTCFullYear());
  assert.ok(balances.length >= 1, "balance row created for the balance-based type");
  assert.equal(
    balances.find((b) => String(b.leaveTypeId) === String(annual.id)).entitlementDays,
    12
  );
  assert.ok(
    fakes.auditRepository.entries.some((e) => e.action === "USER.CREATED" && e.metadata?.jatahCuti === 12),
    "create audit carries jatahCuti"
  );
});

test("FR-002: editing jatahCuti preserves consumed days and requires a reason", async () => {
  const { fakes, leaveBalanceRepository, leaveTypeService, leaveBalanceService, userAdminService } = makeServices();
  await leaveTypeService.create({ key: "ANNUAL", name: "Annual Leave", isBalanceBased: true }, ACTOR);
  const role = fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const user = await userAdminService.createUser({
    username: "emp.q2",
    email: "emp.q2@corp.io",
    name: "Emp Q2",
    roleIds: [role.id],
    initialPassword: "QuotaPass2026!",
    jatahCuti: 12,
  }, ACTOR);

  // simulate 4 consumed days
  const type = await fakes.leaveTypeRepository.findByKey("ANNUAL");
  const year = new Date().getUTCFullYear();
  await leaveBalanceRepository.adjust(user.id, type.id, year, { deltaConsumed: 4 });

  // missing reason -> 400
  await assert.rejects(
    userAdminService.updateUser(user.id, { jatahCuti: 15 }, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "reason"
  );

  // valid edit: entitlement 12 -> 15, consumed preserved
  const updated = await userAdminService.updateUser(
    user.id,
    { jatahCuti: 15, reason: "Kenaikan jatah tahunan" },
    ACTOR
  );
  const balance = await leaveBalanceRepository.findByUserAndType(user.id, type.id, year);
  assert.equal(balance.entitlementDays, 15);
  assert.equal(balance.consumedDays, 4);
  assert.ok(
    fakes.auditRepository.entries.some(
      (e) => e.action === "LEAVE.QUOTA_ADJUSTED" && e.metadata?.differenceDays === 3
    ),
    "quota adjustment audited with the delta"
  );
});

test("FR-002: negative-remaining decrease is blocked without override", async () => {
  const { fakes, leaveBalanceRepository, leaveTypeService, leaveBalanceService, userAdminService } = makeServices();
  await leaveTypeService.create({ key: "ANNUAL", name: "Annual Leave", isBalanceBased: true }, ACTOR);
  const role = fakes.roleRepository.seed({ id: "r_emp", key: "EMPLOYEE", name: "Employee", status: "ACTIVE" });
  const user = await userAdminService.createUser({
    username: "emp.q3",
    email: "emp.q3@corp.io",
    name: "Emp Q3",
    roleIds: [role.id],
    initialPassword: "QuotaPass2026!",
    jatahCuti: 12,
  }, ACTOR);
  const type = await fakes.leaveTypeRepository.findByKey("ANNUAL");
  await leaveBalanceRepository.adjust(user.id, type.id, new Date().getUTCFullYear(), { deltaConsumed: 10 });

  await assert.rejects(
    userAdminService.updateUser(user.id, { jatahCuti: 8, reason: "Turun" }, ACTOR),
    (err) => err instanceof ConflictError && err.code === "LEAVE_QUOTA_NEGATIVE"
  );

  // override (leave:manage_balances) allows it
  const overrider = { ...ACTOR, actorPermissions: [...ACTOR.actorPermissions, "leave:manage_balances"] };
  await userAdminService.updateUser(user.id, { jatahCuti: 8, reason: "Turun dengan persetujuan" }, overrider);
  const balance = await leaveBalanceRepository.findByUserAndType(user.id, type.id, new Date().getUTCFullYear());
  assert.equal(balance.entitlementDays, 8);
});

test("FR-006: balance-based leave submission exceeding remaining is rejected (409)", async () => {
  const { fakes, leaveBalanceRepository, leaveTypeService, leaveBalanceService, leaveService } = makeServices();
  await leaveTypeService.create({ key: "ANNUAL", name: "Annual Leave", isBalanceBased: true }, ACTOR);
  const type = await fakes.leaveTypeRepository.findByKey("ANNUAL");
  const year = new Date().getUTCFullYear();
  fakes.userRepository.seed({ id: "u_emp", username: "u_emp", email: "u@corp.io", name: "Emp", status: "ACTIVE" });
  await leaveBalanceService.ensureEntitlement({ userId: "u_emp", leaveTypeId: type.id, year, entitlementDays: 3 });

  await assert.rejects(
    leaveService.submit({
      requesterId: "u_emp",
      input: { leaveType: type.id, startDate: "2026-09-01", endDate: "2026-09-05", reason: "Libur panjang" },
      actor: {},
    }),
    (err) => err instanceof ConflictError && err.code === "LEAVE_BALANCE_EXCEEDED"
  );

  // within balance -> OK
  const ok = await leaveService.submit({
    requesterId: "u_emp",
    input: { leaveType: type.id, startDate: "2026-09-01", endDate: "2026-09-02", reason: "Libur" },
    actor: {},
  });
  assert.equal(ok.status, "PENDING_APPROVAL");
});
