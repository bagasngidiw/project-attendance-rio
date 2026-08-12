/**
 * Idempotent seed (design §7.8): roles, permission registry, role→permission
 * mapping, the bootstrap SUPER_ADMIN user, and demo accounts for local
 * development.
 *
 * Safe to run on every boot — `$setOnInsert` semantics mean existing data is
 * never overwritten. The bootstrap admin is created when missing AND its
 * SUPER_ADMIN role membership is always ensured, so a pre-existing account
 * can never be left with zero roles.
 */

const {
  PERMISSION_DEFINITIONS,
  ALL_PERMISSIONS,
  assertRegisteredPermission,
} = require("../../domain/permissions");
const { validateRoleInput } = require("../../domain/model");
const { SYSTEM_LEAVE_TYPES } = require("../../domain/leave-type");
const { SYSTEM_SICKNESS_TYPES } = require("../../domain/sickness-type");

/**
 * Role → permission matrix seeded from Project.txt + FR-002.
 * EMPLOYEE = self-service; HR_ADMIN = full HR ops; MANAGER = team review;
 * SUPER_ADMIN = everything including platform administration.
 */
const ROLE_SEED = Object.freeze([
  {
    key: "EMPLOYEE",
    name: "Employee",
    description: "Self-service access to own attendance, overtime, trips and leave.",
    isSystem: true,
    // FR-064: role level + data scope defaults (explicit permission still governs access).
    level: 10,
    levelLabel: "Employee",
    dataScope: "SELF",
    permissions: [
      ...ROLE_SEED_EMPLOYEE_PERMISSIONS(),
    ],
  },
  {
    key: "MANAGER",
    name: "Manager",
    description: "Team overview and approval authority for team requests.",
    isSystem: true,
    level: 50,
    levelLabel: "Lower-Level Approver",
    dataScope: "DIRECT_SUBORDINATES",
    permissions: [
      ...ROLE_SEED_EMPLOYEE_PERMISSIONS(),
      "attendance:view_all",
      // FR-053: managers review their direct reports' attendance exceptions.
      "attendance:review_exceptions",
      "overtime:view_all",
      "overtime:review",
      "overtime:approve",
      "trip:view_all",
      "trip:review",
      "trip:approve",
      "leave:view_all",
      "leave:review",
      "leave:approve",
      // FR-007: Permission (Ijin) review/approve for managers.
      "permission:view_all",
      "permission:review",
      "permission:approve",
      // TODO.md: Sakit review/approve for managers.
      "sakit:view_all",
      "sakit:review",
      "sakit:approve",
      "team:view_team",
      "team:view_pending",
      // FR-009: managers can delegate approval authority while away.
      "delegation:manage",
      // FR-064: checklist-facing delegate key.
      "approval:delegate",
      // FR-038: managers generate team-scoped reports.
      "reporting:view",
      "reporting:export_excel",
      "reporting:export_pdf",
    ],
  },
  {
    key: "HR_ADMIN",
    name: "HR Administrator",
    description: "Full HR operations: attendance administration, approvals, user management and reporting.",
    isSystem: true,
    level: 80,
    levelLabel: "Higher-Level Approver",
    dataScope: "DEPARTMENT",
    permissions: [
      ...ROLE_SEED_EMPLOYEE_PERMISSIONS(),
      "attendance:view_all",
      "attendance:correct",
      "overtime:view_all",
      "overtime:review",
      "overtime:approve",
      // FR-055: HR administratively reviews and corrects overtime records.
      "overtime:manage",
      "trip:view_all",
      "trip:review",
      "trip:approve",
      "leave:view_all",
      "leave:review",
      "leave:approve",
      // FR-022: HR manages leave entitlements and adjustments.
      "leave:manage_balances",
      // FR-007: Permission (Ijin) review/approve for HR.
      "permission:view_all",
      "permission:review",
      "permission:approve",
      // TODO.md: Sakit review/approve for HR.
      "sakit:view_all",
      "sakit:review",
      "sakit:approve",
      "users:view",
      "users:create",
      "users:edit",
      "users:deactivate",
      "users:reset_password",
      "users:assign_roles",
      // FR-061: HR imports users in bulk.
      "users:import",
      "org:manage_departments",
      "org:manage_positions",
      "reporting:view",
      "reporting:export_excel",
      "reporting:export_pdf",
      // FR-063/FR-064: HR can drill into reports and see all statuses.
      "reporting:drill_down",
      "reporting:view_all_statuses",
      // FR-059: HR administers the company holiday calendar.
      "calendar:manage_holidays",
      // FR-017: HR manages attachments on in-scope requests.
      "files:delete",
      // Read-only visibility into roles/permissions (FR-011 design §3.4/D3):
      // HR_ADMIN can inspect the RBAC console, but all writes are rbac:manage_*.
      "rbac:view_roles",
      "rbac:view_permissions",
      "audit:view",
    ],
  },
  {
    key: "SUPER_ADMIN",
    name: "Super Administrator",
    description: "Platform administration, RBAC console, audit oversight and security controls.",
    isSystem: true,
    level: 100,
    levelLabel: "Administrator",
    dataScope: "ALL_EMPLOYEES",
    permissions: [
      ...ALL_PERMISSIONS, // includes every registered capability
    ],
  },
]);

/**
 * Employee permission list, reused by derived roles (DRY). Declared as a
 * function so the seed is a static module-level constant.
 */
function ROLE_SEED_EMPLOYEE_PERMISSIONS() {
  return [
    "dashboard:view",
    "profile:view",
    "profile:update",
    "attendance:clock_in",
    "attendance:clock_out",
    "attendance:view_own",
    "overtime:submit",
    "overtime:view_own",
    "trip:submit",
    "trip:view_own",
    "leave:submit",
    "leave:view_own",
    // FR-007: Permission (Ijin) self-service.
    "permission:submit",
    "permission:view_own",
    // TODO.md: Sakit (sickness) self-service.
    "sakit:submit",
    "sakit:view_own",
    // FR-022: employees see their own leave balances.
    "leave:view_balances",
    // FR-017: employees attach supporting files to their own requests.
    "files:upload",
    "files:download",
    // FR-051: users manage their own MFA enrollment.
    "mfa:manage",
  ];
}

// Self-validate the entire seed before anything touches the DB.
for (const role of ROLE_SEED) {
  validateRoleInput(role);
  role.permissions.forEach(assertRegisteredPermission);
}

/**
 * Demo accounts for local development. These make it easy to experience every
 * permission level without a user-management console (which arrives in
 * FR-029). Provisioning is idempotent: accounts are created only when missing
 * and never modified afterwards.
 *
 * SUPERVER_ADMIN is NOT listed here — it is bootstrapped separately from
 * environment config (design §7.8) so production never ships with a hard-coded
 * super admin.
 */
const DEMO_USER_SEED = Object.freeze([
  {
    roleKey: "EMPLOYEE",
    username: "employee",
    email: "employee@corp.io",
    name: "Demo Employee",
    password: "Employee2026!",
  },
  {
    roleKey: "MANAGER",
    username: "manager",
    email: "manager@corp.io",
    name: "Demo Manager",
    password: "Manager2026!",
  },
  {
    roleKey: "HR_ADMIN",
    username: "hradmin",
    email: "hradmin@corp.io",
    name: "Demo HR Admin",
    password: "HrAdmin2026!",
  },
  {
    roleKey: "EMPLOYEE",
    username: "employee.bob",
    email: "employee.bob@corp.io",
    name: "Bob Demo",
    password: "Employee2026!",
  },
  {
    roleKey: "EMPLOYEE",
    username: "employee.ana",
    email: "employee.ana@corp.io",
    name: "Ana Demo",
    password: "Employee2026!",
  },
]);

/**
 * Reporting structure (FR-006) for demo accounts: `username -> managerUsername`.
 * Employees not listed here have no manager (outside any team scope).
 */
const TEAM_SEED = Object.freeze({
  "employee": "manager",
  "employee.bob": "manager",
  "employee.ana": "manager",
});


async function seedDatabase({ roleRepository, permissionRepository, userRepository, passwordHasher, config, leaveTypeRepository = null, sicknessTypeRepository = null, approvalConfigurationRepository = null, logger = console }) {
  // Demo provisioning (extra roles, demo users, system types, approval
  // configs) runs unless explicitly disabled. The SUPER_ADMIN role + account
  // and the permission registry are ALWAYS ensured — the platform can never
  // be left without an administrator (config.seed.demoData).
  const demoData = config?.seed?.demoData !== false;

  // 1) Persist the permission registry (idempotent upsert).
  await permissionRepository.syncDefinitions(
    Object.values(PERMISSION_DEFINITIONS).map(({ key, module, description }) => ({
      key,
      module,
      description,
    }))
  );

  // 1b) Seed system leave types (FR-058) so the leave form works out of the box.
  if (demoData && leaveTypeRepository) {
    for (const type of SYSTEM_LEAVE_TYPES) {
      const existing = await leaveTypeRepository.findByKey(type.key);
      if (!existing) {
        await leaveTypeRepository.create({ ...type, isSystem: true, status: "ACTIVE" });
      }
    }
  }

  // 1c) Seed system sickness types (TODO.md §5) so the Sakit form works out
  // of the box — otherwise the type dropdown is empty and no request can be
  // submitted until an administrator creates a type.
  if (demoData && sicknessTypeRepository) {
    for (const type of SYSTEM_SICKNESS_TYPES) {
      const existing = await sicknessTypeRepository.findByKey(type.key);
      if (!existing) {
        await sicknessTypeRepository.create({ ...type, isSystem: true, status: "ACTIVE" });
      }
    }
  }

  // 2) Upsert roles (SUPER_ADMIN always; the other demo roles only when
  // demo data is enabled).
  const createdRoles = [];
  const rolesToSeed = demoData
    ? ROLE_SEED
    : ROLE_SEED.filter((r) => r.key === "SUPER_ADMIN");
  for (const roleSeed of rolesToSeed) {
    let role = await roleRepository.findByKey(roleSeed.key);
    if (!role) {
      const { RoleModel } = require("../models/role.model");
      role = await RoleModel.create({
        key: roleSeed.key,
        name: roleSeed.name,
        description: roleSeed.description,
        isSystem: roleSeed.isSystem,
        status: "ACTIVE",
        level: roleSeed.level,
        levelLabel: roleSeed.levelLabel,
        dataScope: roleSeed.dataScope,
      });
    } else {
      // FR-064 backfill: persist level/levelLabel/dataScope on pre-existing
      // roles so every environment carries the new role attributes.
      let levelChanged = false;
      if (role.level === undefined || role.level === null) {
        role.level = roleSeed.level;
        levelChanged = true;
      }
      if (role.levelLabel === undefined || role.levelLabel === null) {
        role.levelLabel = roleSeed.levelLabel;
        levelChanged = true;
      }
      if (role.dataScope === undefined || role.dataScope === null) {
        role.dataScope = roleSeed.dataScope;
        levelChanged = true;
      }
      if (levelChanged) await role.save();
    }
    // Ensure the seed permission set matches the role (only adds missing).
    await permissionRepository.assignToRole(role.id, roleSeed.permissions, null);
    createdRoles.push({ role, seed: roleSeed });
  }

  // 2b) Seed default approval configurations (agents.md §5/§6) so every
  // request type — including SAKIT — has eligible approver roles out of the
  // box. Only created when missing: Superadmin-configured values are never
  // overwritten, and "Tambahkan sendiri" suggestions are unaffected.
  if (demoData && approvalConfigurationRepository) {
    const { CONFIG_REQUEST_TYPES } = require("../../domain/approval-configuration");
    const defaultRoles = [];
    for (const seed of [
      ["MANAGER", 2],
      ["HR_ADMIN", 3],
    ]) {
      const role = createdRoles.find((r) => r.role.key === seed[0])?.role;
      if (role) {
        defaultRoles.push({
          roleId: role.id,
          approvalLevel: seed[1],
          canApprove: true,
          canBeTarget: true,
        });
      }
    }
    for (const requestType of CONFIG_REQUEST_TYPES) {
      const existing = await approvalConfigurationRepository.getByType(requestType);
      if (!existing && defaultRoles.length > 0) {
        await approvalConfigurationRepository.upsert(
          { requestType, roles: defaultRoles, selfApproval: false },
          null
        );
      }
    }
  }

  // 3) Bootstrap SUPER_ADMIN user + ensure SUPER_ADMIN role membership.
  const superAdminRole = createdRoles.find((r) => r.role.key === "SUPER_ADMIN")?.role;
  if (superAdminRole) {
    const existing = await userRepository.findByUsername(config.seed.superAdminUsername);
    let admin = existing;
    if (!admin) {
      const passwordHash = await passwordHasher.hash(config.seed.superAdminPassword);
      admin = await userRepository.create({
        username: config.seed.superAdminUsername,
        email: config.seed.superAdminEmail,
        name: "Super Administrator",
        passwordHash,
        mustChangePassword: true,
      });
      logger.info(`[seed] Bootstrapped SUPER_ADMIN user "${admin.username}" (must change password on first sign-in).`);
    }
    // Repair path: if the account pre-existed but lost its role membership,
    // restore it so the platform can never have an admin with zero roles.
    if (admin.status !== "ACTIVE") {
      admin.status = "ACTIVE";
      await admin.save();
    }
    await ensureUserRole(admin.id, superAdminRole.id);
  }

  // 4) Provision demo accounts (idempotent; local development only).
  if (demoData) {
  const demoUsersByUsername = new Map();
  for (const demo of DEMO_USER_SEED) {
    const role = createdRoles.find((r) => r.role.key === demo.roleKey)?.role;
    if (!role) continue;
    let user = await userRepository.findByUsername(demo.username);
    if (!user) {
      const passwordHash = await passwordHasher.hash(demo.password);
      user = await userRepository.create({
        username: demo.username,
        email: demo.email,
        name: demo.name,
        passwordHash,
        mustChangePassword: false,
      });
      logger.info(`[seed] Provisioned demo "${demo.roleKey}" user "${demo.username}".`);
    }
    // Repair path: reactivate demo accounts so the local demo experience stays
    // usable even after a manual deactivation or a DB restore.
    if (user.status !== "ACTIVE") {
      user.status = "ACTIVE";
      await user.save();
    }
    await ensureUserRole(user.id, role.id);
    demoUsersByUsername.set(demo.username, user);
  }

  // 4b) Wire the demo reporting structure (FR-006): set `managerId` on each
  // demo employee so the demo manager has a real team to review.
  await wireReportingStructure({ userRepository, demoUsersByUsername });
  }

  // 4c) Backfill the denormalized `roleIds` mirror on every user so the
  // collection carries its role relations (kept in sync by
  // UserRoleRepository.replaceRolesForUser afterwards). Runs for every user,
  // including the bootstrapped SUPER_ADMIN.
  await backfillRoleIds();

  logger.info("[seed] Permissions, roles and role-permission mapping are up to date.");
  return { roles: createdRoles.map((r) => r.role.key) };
}

/**
 * Idempotently assigns a role to a user (no-op when already assigned).
 */
async function ensureUserRole(userId, roleId) {
  const { UserRoleModel } = require("../models/user-role.model");
  const existing = await UserRoleModel.findOne({ userId, roleId });
  if (!existing) {
    await UserRoleModel.create({ userId, roleId, assignedBy: userId });
  }
}

/**
 * Idempotently applies the demo reporting structure (FR-006): sets `managerId`
 * on each demo employee whose manager exists. Never overwrites a managerId
 * that an operator may have configured manually on an existing account.
 */
async function wireReportingStructure({ userRepository, demoUsersByUsername }) {
  for (const [username, managerUsername] of Object.entries(TEAM_SEED)) {
    const employee = demoUsersByUsername.get(username);
    const manager = demoUsersByUsername.get(managerUsername);
    if (!employee || !manager) continue;
    if (employee.managerId && String(employee.managerId) !== String(manager.id)) continue;
    employee.managerId = manager.id;
    await employee.save();
  }
}

/**
 * Backfills the User document's `roleIds` mirror from the `user_roles` join
 * collection. Idempotent; safe on every boot.
 */
async function backfillRoleIds() {
  const { UserRoleModel } = require("../models/user-role.model");
  const { UserModel } = require("../models/user.model");
  const rows = await UserRoleModel.aggregate([
    { $group: { _id: "$userId", roleIds: { $push: "$roleId" } } },
  ]);
  for (const row of rows) {
    await UserModel.updateOne({ _id: row._id }, { $set: { roleIds: row.roleIds } });
  }
}

module.exports = { seedDatabase, ROLE_SEED, DEMO_USER_SEED, TEAM_SEED };
