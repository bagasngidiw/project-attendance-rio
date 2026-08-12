/**
 * UserAdminService — user account lifecycle orchestration (FR-029 / FR-028).
 *
 * Create, edit, deactivate/activate, list/search, and password reset for the
 * HR administration surface. Builds on the auth/RBAC foundation: every
 * mutation validates invariants, records USER.* audit events, and propagates
 * the change immediately (tokenVersion bump). The last ACTIVE SUPER_ADMIN can
 * never be deactivated (FR-057 foundation).
 */

const { Email } = require("../domain/model");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  PasswordPolicyError,
} = require("../domain/errors");
const {
  validateWorkSchedule,
  validateQuotaAllocation,
} = require("../domain/user-schedule");

class UserAdminService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/password-hasher').BcryptPasswordHasher} deps.passwordHasher
   * @param {import('./password.service').PasswordService} deps.passwordService
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/repositories/org.repository').OrgRepository} [deps.orgRepository] optional (FR-024 inactive-reference guard)
   * @param {import('../infrastructure/event-bus').EventBus} [deps.eventBus] optional (FR-014 notification hook)
   */
  constructor({
    userRepository,
    roleRepository,
    userRoleRepository,
    passwordHasher,
    passwordService,
    auditService,
    orgRepository = null,
    eventBus = null,
    leaveTypeRepository = null,
    leaveBalanceService = null,
  }) {
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.passwordHasher = passwordHasher;
    this.passwordService = passwordService;
    this.auditService = auditService;
    this.orgRepository = orgRepository;
    this.leaveTypeRepository = leaveTypeRepository;
    this.leaveBalanceService = leaveBalanceService;
    this.eventBus = eventBus;
  }

  /** Guards deactivated org references on assignment (FR-024 §4.6). */
  async assertActiveOrgRefs({ departmentId, positionId }) {
    if (departmentId) {
      const department = await this.orgRepository.getDepartment(departmentId);
      if (department.status !== "ACTIVE") {
        throw new ConflictError(
          "The selected department is inactive. Reactivate it first.",
          "ORG_INACTIVE"
        );
      }
    }
    if (positionId) {
      const position = await this.orgRepository.getPosition(positionId);
      if (position.status !== "ACTIVE") {
        throw new ConflictError(
          "The selected position is inactive. Reactivate it first.",
          "ORG_INACTIVE"
        );
      }
    }
  }

  /**
   * Creates a user account (FR-029 §5.1): validated identity, at least one
   * ACTIVE role, policy-compliant temporary credential with the
   * `mustChangePassword` gate set. Records USER.CREATED.
   *
   * @param {{ username: string, email: string, name: string, departmentId?: string, positionId?: string, managerId?: string, roleIds: string[], initialPassword: string }} input
   * @param {object} actor
   */
  async createUser(input, actor = {}) {
    const username = String(input.username ?? "").trim().toLowerCase();
    const name = String(input.name ?? "").trim();

    if (username.length < 2 || username.length > 64) {
      throw new ValidationError("Username must be 2-64 characters.", {
        field: "username",
      });
    }
    if (name.length < 2) {
      throw new ValidationError("Name must be at least 2 characters.", {
        field: "name",
      });
    }
    new Email(input.email); // throws ValidationError when malformed

    if (!input.roleIds || input.roleIds.length === 0) {
      throw new ValidationError("At least one role must be assigned.", {
        field: "roleIds",
      });
    }

    const roles = await this.roleRepository.findByIds(input.roleIds);
    if (roles.length !== input.roleIds.length) {
      throw new NotFoundError("One or more roles do not exist.", "ROLE_NOT_FOUND");
    }
    const disabled = roles.find((role) => role.status !== "ACTIVE");
    if (disabled) {
      throw new ConflictError(
        `Role "${disabled.key}" is disabled and cannot be assigned.`,
        "ROLE_DISABLED"
      );
    }

    if (this.orgRepository) {
      await this.assertActiveOrgRefs({
        departmentId: input.departmentId,
        positionId: input.positionId,
      });
    }

    await this.passwordService.assertPasswordCompliant(input.initialPassword);
    const passwordHash = await this.passwordHasher.hash(input.initialPassword);

    const user = await this.userRepository.create({
      username,
      email: input.email,
      name,
      passwordHash,
      status: "ACTIVE",
      mustChangePassword: true,
      departmentId: input.departmentId,
      positionId: input.positionId,
      managerId: input.managerId,
    });

    await this.userRoleRepository.replaceRolesForUser(
      user.id,
      input.roleIds,
      actor.actorId ?? null
    );

    // TODO.md FR-001: initialize the authoritative balance + mirror for every
    // balance-based leave type when a quota is supplied (default 0).
    if (this.leaveBalanceService && input.jatahCuti !== undefined) {
      const year = new Date().getUTCFullYear();
      const balanceTypes = await this.leaveBalanceService.listBalanceBasedTypes();
      for (const type of balanceTypes) {
        const leaveTypeId = String(type.id ?? type._id);
        await this.leaveBalanceService.ensureEntitlement({
          userId: user.id,
          leaveTypeId,
          year,
          entitlementDays: input.jatahCuti,
        });
        await this.userRepository.upsertLeaveQuota(user.id, {
          leaveTypeId,
          allocatedDays: input.jatahCuti,
        });
      }
    }

    await this.auditService.record({
      action: "USER.CREATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: user.id, summary: user.username },
      outcome: "SUCCESS",
      metadata: {
        roleKeys: roles.map((r) => r.key).sort(),
        departmentId: user.departmentId?.toString?.() ?? null,
        positionId: user.positionId?.toString?.() ?? null,
        managerId: user.managerId?.toString?.() ?? null,
        jatahCuti: input.jatahCuti ?? 0,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toUserDto(user, roles.map((r) => r.key), user.mustChangePassword);
  }

  /**
   * Updates mutable identity/org fields (FR-029 §4.1 PUT /users/:id).
   * Records USER.UPDATED.
   *
   * @param {string} userId
   * @param {{ name?: string, email?: string, departmentId?: string, positionId?: string, managerId?: string }} input
   * @param {object} actor
   */
  async updateUser(userId, input, actor = {}) {
    const user = await this.userRepository.assertExists(userId);

    if (input.email !== undefined && input.email !== "") {
      new Email(input.email);
    }
    if (input.managerId !== undefined && input.managerId) {
      if (String(input.managerId) === String(userId)) {
        throw new ValidationError("A user cannot be their own manager.", {
          field: "managerId",
        });
      }
    }

    if (this.orgRepository) {
      await this.assertActiveOrgRefs({
        departmentId: input.departmentId,
        positionId: input.positionId,
      });
    }

    const before = {
      name: user.name,
      email: user.email,
      departmentId: user.departmentId?.toString?.() ?? null,
      positionId: user.positionId?.toString?.() ?? null,
      managerId: user.managerId?.toString?.() ?? null,
    };
    const updated = await this.userRepository.update(userId, {
      name: input.name,
      email: input.email,
      departmentId: input.departmentId,
      positionId: input.positionId,
      managerId: input.managerId,
    });

    // TODO.md FR-002: quota edit — set entitlement (preserve consumed/reserved),
    // mandatory reason, negative-remaining guard (override requires
    // `leave:manage_balances`). Applies to every balance-based leave type.
    if (input.jatahCuti !== undefined) {
      if (this.leaveBalanceService) {
        if (!String(input.reason ?? "").trim()) {
          throw new ValidationError("Alasan perubahan jatah cuti wajib diisi.", {
            field: "reason",
          });
        }
        const year = new Date().getUTCFullYear();
        const balanceTypes = await this.leaveBalanceService.listBalanceBasedTypes();
        const override = Boolean(
          (actor.actorPermissions ?? []).includes("leave:manage_balances")
        );
        for (const type of balanceTypes) {
          const leaveTypeId = String(type.id ?? type._id);
          await this.leaveBalanceService.setEntitlement({
            userId,
            leaveTypeId,
            year,
            entitlementDays: input.jatahCuti,
            reason: input.reason,
            override,
            actor,
          });
          await this.userRepository.upsertLeaveQuota(userId, {
            leaveTypeId,
            allocatedDays: input.jatahCuti,
          });
        }
      }
    }

    const roleKeys = await this.loadRoleKeys(userId);
    await this.auditService.record({
      action: "USER.UPDATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: updated.username },
      outcome: "SUCCESS",
      metadata: { before, after: {
        name: updated.name,
        email: updated.email,
        departmentId: updated.departmentId?.toString?.() ?? null,
        positionId: updated.positionId?.toString?.() ?? null,
        managerId: updated.managerId?.toString?.() ?? null,
      } },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toUserDto(updated, roleKeys, updated.mustChangePassword);
  }

  /**
   * Deactivates a user (FR-029): reversible, preserves records, blocks
   * sign-in, invalidates outstanding access tokens. The last ACTIVE
   * SUPER_ADMIN can never be deactivated (FR-057).
   */
  async deactivateUser(userId, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    await this.assertNotLastSuperAdmin(userId);

    const updated = await this.userRepository.setStatus(userId, "INACTIVE");
    await this.userRepository.bumpTokenVersion(updated);
    const roleKeys = await this.loadRoleKeys(userId);

    await this.auditService.record({
      action: "USER.DEACTIVATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: updated.username },
      outcome: "SUCCESS",
      metadata: { roleKeys },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toUserDto(updated, roleKeys, updated.mustChangePassword);
  }

  /** Re-activates a previously deactivated user. Records USER.ACTIVATED. */
  async activateUser(userId, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    const updated = await this.userRepository.setStatus(userId, "ACTIVE");
    const roleKeys = await this.loadRoleKeys(userId);

    await this.auditService.record({
      action: "USER.ACTIVATED",
      actor: { userId: actor.actorId, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: updated.username },
      outcome: "SUCCESS",
      metadata: { roleKeys },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.toUserDto(updated, roleKeys, updated.mustChangePassword);
  }

  /**
   * Paginated, searchable user list (FR-029/FR-023).
   *
   * @param {{ search?: string, status?: string, roleId?: string, departmentId?: string, page?: number, pageSize?: number }} filters
   */
  async listUsers({ search, status, roleId, departmentId, page = 1, pageSize = 20 } = {}) {
    let userIds;
    if (roleId) {
      userIds = await this.userRoleRepository.userIdsForRole(roleId);
    }

    const { items, total } = await this.userRepository.list({
      search,
      status,
      departmentId,
      userIds,
      page,
      pageSize,
    });

    const enriched = await this.enrichRoleKeys(items);
    return { items: enriched, total, page, pageSize };
  }

  /**
   * Single user with role keys (FR-029 GET /users/:id).
   *
   * @param {string} userId
   */
  async getUser(userId) {
    const user = await this.userRepository.assertExists(userId);
    const roleKeys = await this.loadRoleKeys(userId);
    const roleIds = (await this.userRoleRepository.roleIdsForUser(userId)).map((id) => String(id));
    // NOTE: do not spread the Mongoose document — schema fields are prototype
    // accessors, so build the normalized shape explicitly.
    const normalized = {
      id: user.id ?? user._id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      departmentId: user.departmentId?.toString?.() ?? null,
      positionId: user.positionId?.toString?.() ?? null,
      managerId: user.managerId?.toString?.() ?? null,
    };
    const names = await this.loadRelationNames([normalized]);
    return this.toUserDto(normalized, roleKeys, user.mustChangePassword, {
      roleIds,
      ...names.get(String(normalized.id)),
    });
  }

  /**
   * Resets a user's password to a temporary credential (FR-028): policy
   * compliant, `mustChangePassword` gate set, tokenVersion bumped so existing
   * sessions die immediately. Records USER.PASSWORD_RESET.
   *
   * @param {string} userId
   * @param {{ initialPassword: string }} input
   * @param {object} actor
   */
  async resetPassword(userId, { initialPassword }, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    const policy = await this.passwordService.getPasswordPolicy();

    await this.passwordService.assertPasswordCompliant(initialPassword);
    const temporaryHash = await this.passwordHasher.hash(initialPassword);
    await this.userRepository.resetPassword(user, temporaryHash, {
      historyLimit: policy.historyLength,
    });

    await this.auditService.record({
      action: "USER.PASSWORD_RESET",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { passwordVersion: user.passwordVersion },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    if (this.eventBus) {
      await this.eventBus.publish("auth.password_reset", { userId });
    }

    return {
      userId,
      mustChangePassword: true,
      message: "Password reset. User must change it at next sign-in.",
    };
  }

  /** Guards deactivation/demotion of the last ACTIVE SUPER_ADMIN (FR-057). */
  async assertNotLastSuperAdmin(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    const allRoles = await this.roleRepository.listAll();
    const roleKeysById = new Map(allRoles.map((r) => [String(r.id), r.key]));

    const isSuperAdmin = roleIds.some((id) => roleKeysById.get(String(id)) === "SUPER_ADMIN");
    if (!isSuperAdmin) return;

    const superAdminRole = allRoles.find((r) => r.key === "SUPER_ADMIN");
    if (!superAdminRole) return;

    const holders = await this.userRoleRepository.userIdsForRole(superAdminRole.id);
    let otherActiveSuperAdmins = 0;
    for (const holderId of holders) {
      if (String(holderId) === String(userId)) continue;
      const holder = await this.userRepository.findById(holderId);
      if (holder && holder.status === "ACTIVE") otherActiveSuperAdmins += 1;
    }

    if (otherActiveSuperAdmins === 0) {
      throw new ConflictError(
        "Cannot deactivate the last active SUPER_ADMIN.",
        "SUPER_ADMIN_GUARD"
      );
    }
  }

  /** Loads the role keys assigned to a user. */
  async loadRoleKeys(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    const roles = await this.roleRepository.findByIds(roleIds);
    return roles.map((role) => role.key).sort();
  }

  /**
   * Enriches a list of user docs with role keys + roleIds + human-readable
   * relation names (department/position/manager). Batch lookups keep the list
   * endpoint efficient for paginated results.
   */
  async enrichRoleKeys(users) {
    if (users.length === 0) return [];

    const memberships = await Promise.all(
      users.map(async (u) => ({
        userId: String(u._id ?? u.id),
        roleIds: await this.userRoleRepository.roleIdsForUser(u._id ?? u.id),
      }))
    );
    const allRoleIds = [...new Set(memberships.flatMap((m) => m.roleIds.map((id) => String(id))))];
    const roles = await this.roleRepository.findByIds(allRoleIds);
    const roleKeyById = new Map(roles.map((r) => [String(r.id), r.key]));

    const withIds = users.map((u) => ({
      ...u,
      id: u._id ?? u.id,
      departmentId: u.departmentId?.toString?.() ?? null,
      positionId: u.positionId?.toString?.() ?? null,
      managerId: u.managerId?.toString?.() ?? null,
    }));
    const names = await this.loadRelationNames(withIds);

    return withIds.map((u) => {
      const membership = memberships.find((m) => m.userId === String(u.id));
      const roleIds = (membership?.roleIds ?? []).map((id) => String(id));
      const roleKeys = roleIds
        .map((id) => roleKeyById.get(id))
        .filter(Boolean)
        .sort();
      return this.toUserDto(u, roleKeys, u.mustChangePassword ?? false, {
        roleIds,
        ...names.get(String(u.id)),
      });
    });
  }

  /**
   * Batch-loads department/position/manager display names for user DTOs.
   *
   * @param {Array<{ id: string, departmentId: string|null, positionId: string|null, managerId: string|null }>} users
   * @returns {Promise<Map<string, { departmentName: string|null, positionName: string|null, managerName: string|null }>>}
   */
  async loadRelationNames(users) {
    const deptIds = [...new Set(users.map((u) => u.departmentId).filter(Boolean))];
    const posIds = [...new Set(users.map((u) => u.positionId).filter(Boolean))];
    const mgrIds = [...new Set(users.map((u) => u.managerId).filter(Boolean))];

    const [departments, positions, managers] = await Promise.all([
      this.orgRepository && deptIds.length > 0 ? this.orgRepository.listDepartments() : [],
      this.orgRepository && posIds.length > 0 ? this.orgRepository.listPositions() : [],
      mgrIds.length > 0
        ? this.userRepository.list({ userIds: mgrIds, page: 1, pageSize: 100 })
        : { items: [] },
    ]);

    const deptName = new Map(departments.map((d) => [String(d._id ?? d.id), d.name]));
    const posName = new Map(positions.map((p) => [String(p._id ?? p.id), p.name]));
    const mgrName = new Map(
      managers.items.map((m) => [String(m._id ?? m.id), m.username])
    );

    const map = new Map();
    for (const u of users) {
      map.set(String(u.id), {
        departmentName: u.departmentId ? deptName.get(u.departmentId) ?? null : null,
        positionName: u.positionId ? posName.get(u.positionId) ?? null : null,
        managerName: u.managerId ? mgrName.get(u.managerId) ?? null : null,
      });
    }
    return map;
  }

  /**
   * TODO.md §8/§9: sets an employee's work schedule (days + hours), validated.
   *
   * @param {string} userId
   * @param {{ workingDays?: number[], workingStartTime?: string, workingEndTime?: string }} input
   * @param {object} actor
   */
  async updateWorkSchedule(userId, input = {}, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    const validated = validateWorkSchedule({
      workingDays: input.workingDays,
      workingStartTime: input.workingStartTime,
      workingEndTime: input.workingEndTime,
    });
    const updated = await this.userRepository.update(userId, {
      workingDays: validated.workingDays,
      workingStartTime: validated.workingStartTime,
      workingEndTime: validated.workingEndTime,
    });
    await this.auditService.record({
      action: "USER.UPDATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { field: "workSchedule", workingDays: validated.workingDays },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toUserDto(updated, await this.loadRoleKeys(userId), user.mustChangePassword);
  }

  /**
   * TODO.md §7: upserts a per-leave-type quota for an employee (allocated
   * days). Used days are tracked separately on approval.
   *
   * @param {string} userId
   * @param {{ leaveTypeId: string, allocatedDays: number }} input
   * @param {object} actor
   */
  async upsertLeaveQuota(userId, { leaveTypeId, allocatedDays }, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    validateQuotaAllocation({ leaveTypeId, allocatedDays });
    if (this.leaveTypeRepository) {
      const leaveType = await this.leaveTypeRepository.getById(leaveTypeId);
      if (!leaveType) {
        throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
      }
    }
    const updated = await this.userRepository.upsertLeaveQuota(userId, { leaveTypeId, allocatedDays });
    await this.auditService.record({
      action: "USER.UPDATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { field: "leaveQuota", leaveTypeId, allocatedDays },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toUserDto(updated, await this.loadRoleKeys(userId), user.mustChangePassword);
  }

  toUserDto(user, roleKeys, mustChangePassword, relations = {}) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      mustChangePassword,
      departmentId: user.departmentId?.toString?.() ?? null,
      positionId: user.positionId?.toString?.() ?? null,
      managerId: user.managerId?.toString?.() ?? null,
      // TODO.md §7/§8/§9: employee work schedule + per-type leave quotas.
      workingDays: user.workingDays ?? [],
      workingStartTime: user.workingStartTime ?? "",
      workingEndTime: user.workingEndTime ?? "",
      leaveQuotas: (user.leaveQuotas ?? []).map((q) => ({
        leaveTypeId: String(q.leaveTypeId),
        allocatedDays: q.allocatedDays ?? 0,
        usedDays: q.usedDays ?? 0,
        remainingDays: Math.max(0, (q.allocatedDays ?? 0) - (q.usedDays ?? 0)),
      })),
      // FR-064/relation model: the user's role refs + human-readable names for
      // the related collections so the UI never shows raw ObjectIds.
      roleIds: relations.roleIds ?? [],
      roles: roleKeys ?? [],
      departmentName: relations.departmentName ?? null,
      positionName: relations.positionName ?? null,
      managerName: relations.managerName ?? null,
    };
  }
}

module.exports = { UserAdminService };
