/**
 * In-memory fakes for repository ports — used by application-layer unit tests
 * so business logic is verified without MongoDB.
 */

const {
  computeEventHash,
  classifyEvent,
  scrubMetadata,
} = require("../../src/domain/audit");

class InMemoryAuditEventRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async append(event, salt) {
    const prev = this.entries[this.entries.length - 1];
    const prevHash = prev?.hash ?? "";
    const recordedAt = new Date().toISOString();
    const hash = computeEventHash({
      prevHash,
      action: event.action,
      actorUserId: event.actor?.userId?.toString?.() ?? "",
      subjectId: event.subject?.id ?? "",
      outcome: event.outcome,
      recordedAt,
      salt,
    });
    const entry = {
      id: `evt_${this.nextId++}`,
      ...event,
      metadata: event.metadata ?? {},
      prevHash,
      hash,
      recordedAt: new Date(recordedAt),
    };
    this.entries.push(entry);
    return { prevHash, hash };
  }

  async verifyChain(salt) {
    let expectedPrev = "";
    for (let i = 0; i < this.entries.length; i++) {
      const event = this.entries[i];
      const recomputed = computeEventHash({
        prevHash: expectedPrev,
        action: event.action,
        actorUserId: event.actor?.userId?.toString?.() ?? "",
        subjectId: event.subject?.id ?? "",
        outcome: event.outcome,
        recordedAt: new Date(event.recordedAt).toISOString(),
        salt,
      });
      if (event.hash !== recomputed || event.prevHash !== expectedPrev) {
        return { valid: false, firstBrokenIndex: i, count: this.entries.length };
      }
      expectedPrev = event.hash;
    }
    return { valid: true, firstBrokenIndex: null, count: this.entries.length };
  }

  async findById(id) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async query(filters = {}, scope = {}) {
    let items = this.entries.filter((e) => {
      if (filters.action && e.action !== filters.action) return false;
      if (filters.outcome && e.outcome !== filters.outcome) return false;
      if (filters.actorId && e.actor?.userId !== filters.actorId) return false;
      if (scope.actorId && e.actor?.userId !== scope.actorId) return false;
      return true;
    });
    items = [...items].reverse();
    const total = items.length;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }
}

class InMemoryActivityLogRepository {
  constructor() {
    this.entries = [];
  }

  async insert(record) {
    this.entries.push({
      ...record,
      recordedAt: new Date(),
    });
  }

  async query(filters = {}, scope = {}) {
    let items = this.entries.filter((e) => {
      if (filters.action && e.action !== filters.action) return false;
      if (filters.actorId && e.actor?.userId !== filters.actorId) return false;
      if (scope.actorId && e.actor?.userId !== scope.actorId) return false;
      return true;
    });
    items = [...items].reverse();
    const total = items.length;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }
}

class InMemoryOutboxRepository {
  constructor() {
    this.entries = [];
  }

  async enqueue(eventType, payload) {
    const entry = { _id: `out_${this.entries.length + 1}`, eventType, payload, status: "PENDING", attemptCount: 0 };
    this.entries.push(entry);
    return entry;
  }

  async claimPending(limit = 100) {
    return this.entries.filter((e) => e.status === "PENDING").slice(0, limit);
  }

  async markPublished(id) {
    const entry = this.entries.find((e) => e._id === id);
    if (entry) entry.status = "PUBLISHED";
  }

  async markFailed(id, errorMessage) {
    const entry = this.entries.find((e) => e._id === id);
    if (entry) {
      entry.status = "FAILED";
      entry.lastError = errorMessage;
      entry.attemptCount += 1;
    }
  }

  async countPending() {
    return this.entries.filter((e) => e.status === "PENDING").length;
  }
}

/** Compatibility alias used by older tests to read recorded events. */
class InMemoryAuditRepository {
  constructor() {
    this.entries = [];
  }

  async insert(entry) {
    this.entries.push(entry);
  }
}

/** In-memory capture pipeline mirroring AuditEventPublisher semantics. */
class InMemoryAuditPublisher {
  constructor({ auditRepository, activityRepository, chainSalt = "test-salt" }) {
    this.auditRepository = auditRepository;
    this.activityRepository = activityRepository;
    this.chainSalt = chainSalt;
  }

  async publish(event) {
    const { audit, activity } = classifyEvent(event.action);
    const payload = {
      action: event.action,
      actor: event.actor ?? null,
      subject: event.subject ?? null,
      outcome: event.outcome ?? "SUCCESS",
      metadata: scrubMetadata(event.metadata ?? {}),
      correlationId: event.correlationId ?? "",
      ip: event.ip ?? "",
      userAgent: event.userAgent ?? "",
    };
    if (audit) await this.auditRepository.append(payload, this.chainSalt);
    if (activity) await this.activityRepository.insert(payload);
  }

  async dispatchPending() {}
}


class InMemoryPlatformSettingRepository {
  constructor() {
    this.store = new Map(); // key -> { value, updatedBy, updatedAt }
  }

  async get(key) {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(key, value, updatedBy = null) {
    const entry = { value, updatedBy, updatedAt: new Date() };
    this.store.set(key, entry);
    return { key, value, updatedBy, updatedAt: entry.updatedAt };
  }
}

class InMemoryUserRepository {
  constructor() {
    this.users = new Map();
    this.byUsername = new Map();
  }

  seed(user) {
    const id = user.id ?? `u_${this.users.size + 1}`;
    const record = {
      id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status ?? "ACTIVE",
      passwordHash: user.passwordHash,
      tokenVersion: user.tokenVersion ?? 0,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
      lockedUntil: user.lockedUntil ?? null,
      mustChangePassword: user.mustChangePassword ?? false,
      departmentId: user.departmentId ?? null,
      positionId: user.positionId ?? null,
      managerId: user.managerId ?? null,
      roleIds: user.roleIds ?? [],
      workingDays: user.workingDays ?? [],
      workingStartTime: user.workingStartTime ?? "",
      save: async function save() {
        return this;
      },
    };
    this.users.set(id, record);
    this.byUsername.set(record.username, record);
    return record;
  }

  async findByUsername(username) {
    return this.byUsername.get(username.trim().toLowerCase()) ?? null;
  }

  async findByEmail(email) {
    for (const user of this.users.values()) {
      if (user.email === email.trim().toLowerCase()) return user;
    }
    return null;
  }

  async findById(id) {
    return this.users.get(String(id)) ?? null;
  }

  async findByIds(ids) {
    const set = new Set(ids.map(String));
    return [...this.users.values()].filter((u) => set.has(String(u.id)));
  }

  async findByIdsActive(ids) {
    return (await this.findByIds(ids)).filter((u) => u.status === "ACTIVE");
  }

  async upsertLeaveQuota(userId, { leaveTypeId, allocatedDays }) {
    const user = await this.assertExists(userId);
    const row = (user.leaveQuotas ?? []).find((q) => String(q.leaveTypeId) === String(leaveTypeId));
    if (row) {
      row.allocatedDays = allocatedDays;
    } else {
      user.leaveQuotas = [...(user.leaveQuotas ?? []), { leaveTypeId, allocatedDays, usedDays: 0 }];
    }
    return user;
  }

  async incrementLeaveQuotaUsed(userId, { leaveTypeId, days }) {
    const user = this.users.get(String(userId));
    if (!user) return null;
    const row = (user.leaveQuotas ?? []).find((q) => String(q.leaveTypeId) === String(leaveTypeId));
    if (row) row.usedDays = (row.usedDays ?? 0) + days;
    return user;
  }

  async create({ username, email, name, passwordHash, status, mustChangePassword, departmentId, positionId, managerId, nip = "", contractTypeId, placementId }) {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    if (
      this.byUsername.has(normalizedUsername) ||
      [...this.users.values()].some((u) => u.email === normalizedEmail)
    ) {
      const { ConflictError } = require("../../src/domain/errors");
      throw new ConflictError(
        "A user with this username or email already exists.",
        "USER_EXISTS"
      );
    }
    const record = {
      id: `u_${this.users.size + 1}`,
      username: normalizedUsername,
      email: normalizedEmail,
      name,
      passwordHash,
      status: status ?? "ACTIVE",
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: mustChangePassword ?? false,
      passwordVersion: 0,
      passwordChangedAt: new Date(),
      passwordHistory: [],
      departmentId: departmentId ?? null,
      positionId: positionId ?? null,
      managerId: managerId ?? null,
      nip,
      contractTypeId: contractTypeId ?? null,
      placementId: placementId ?? null,
      roleIds: [],
      save: async function save() {
        return this;
      },
    };
    this.users.set(record.id, record);
    this.byUsername.set(record.username, record);
    return record;
  }

  async save(user) {
    this.users.set(user.id, user);
    this.byUsername.set(user.username, user);
    return user;
  }

  async recordFailedLogin(user, maxFailedAttempts, lockoutMs) {
    user.failedLoginAttempts += 1;
    let locked = false;
    let retryAfterMs = 0;
    if (user.failedLoginAttempts >= maxFailedAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutMs);
      locked = true;
      retryAfterMs = lockoutMs;
    }
    return { user, locked, retryAfterMs };
  }

  async resetFailedLogin(user) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    return user;
  }

  async bumpTokenVersion(user) {
    user.tokenVersion += 1;
    return user;
  }

  async update(id, { name, email, departmentId, positionId, managerId, nip, contractTypeId, placementId } = {}) {
    const user = await this.assertExists(id);
    if (email !== undefined && email !== "") user.email = email.trim().toLowerCase();
    if (name !== undefined && name !== "") user.name = name.trim();
    if (departmentId !== undefined) user.departmentId = departmentId || null;
    if (positionId !== undefined) user.positionId = positionId || null;
    if (managerId !== undefined) user.managerId = managerId || null;
    if (nip !== undefined) user.nip = String(nip ?? "").trim();
    if (contractTypeId !== undefined) user.contractTypeId = contractTypeId || null;
    if (placementId !== undefined) user.placementId = placementId || null;
    await this.save(user);
    return user;
  }

  async setStatus(id, status) {
    const user = await this.assertExists(id);
    user.status = status;
    await this.save(user);
    return user;
  }

  async updatePassword(user, passwordHash, { mustChangePassword = false, historyLimit = 5 } = {}) {
    await this.rotatePassword(user, passwordHash, { mustChangePassword, historyLimit });
    return user;
  }

  async resetPassword(user, temporaryHash, { historyLimit = 5 } = {}) {
    await this.rotatePassword(user, temporaryHash, { mustChangePassword: true, historyLimit });
    user.tokenVersion += 1;
    await this.save(user);
    return user;
  }

  async rotatePassword(user, passwordHash, { mustChangePassword, historyLimit }) {
    const history = [...(user.passwordHistory ?? [])];
    if (user.passwordHash) history.push(user.passwordHash);
    user.passwordHash = passwordHash;
    user.passwordHistory = history.slice(-Math.max(0, historyLimit));
    user.passwordVersion = (user.passwordVersion ?? 0) + 1;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = mustChangePassword;
    await this.save(user);
    return user;
  }

  async list({ search, status, departmentId, userIds, page = 1, pageSize = 20 } = {}) {
    if (userIds && userIds.length === 0) return { items: [], total: 0 };
    let items = [...this.users.values()];
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((u) =>
        `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q)
      );
    }
    if (status) items = items.filter((u) => u.status === status);
    if (departmentId) {
      items = items.filter((u) => String(u.departmentId) === String(departmentId));
    }
    if (userIds && userIds.length) {
      const set = new Set(userIds.map(String));
      items = items.filter((u) => set.has(String(u.id)));
    }
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async assertExists(id) {
    const user = this.users.get(String(id));
    if (!user) {
      const { NotFoundError } = require("../../src/domain/errors");
      throw new NotFoundError("User not found.", "USER_NOT_FOUND");
    }
    return user;
  }

  async listActiveUsers() {
    return [...this.users.values()].filter((u) => u.status === "ACTIVE");
  }

  async countActiveUsers() {
    return [...this.users.values()].filter((u) => u.status === "ACTIVE").length;
  }

  async countActiveByDepartment() {
    const map = new Map();
    for (const user of this.users.values()) {
      if (user.status !== "ACTIVE") continue;
      const key = user.departmentId ? String(user.departmentId) : "null";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([key, count]) => ({
      departmentId: key === "null" ? null : key,
      name: null,
      count,
    }));
  }

  async findDirectReports(managerId) {
    return [...this.users.values()]
      .filter(
        (u) =>
          u.status === "ACTIVE" &&
          u.managerId != null &&
          String(u.managerId) === String(managerId)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findDirectReportById(managerId, memberId) {
    const member = this.users.get(String(memberId));
    if (
      !member ||
      member.status !== "ACTIVE" ||
      member.managerId == null ||
      String(member.managerId) !== String(managerId)
    ) {
      return null;
    }
    return member;
  }

  async countDirectReports(managerId) {
    return (await this.findDirectReports(managerId)).length;
  }
}

class InMemoryRoleRepository {
  constructor() {
    this.roles = new Map();
  }

  seed(role) {
    const id = role.id ?? `r_${this.roles.size + 1}`;
    const record = {
      id,
      key: role.key,
      name: role.name,
      description: role.description ?? "",
      isSystem: role.isSystem ?? false,
      status: role.status ?? "ACTIVE",
      level: role.level ?? 10,
      levelLabel: role.levelLabel ?? "",
      dataScope: role.dataScope ?? "SELF",
      version: role.version ?? 1,
      save: async function save() {
        this.version += 1;
        return this;
      },
    };
    this.roles.set(id, record);
    return record;
  }

  async create({ key, name, description = "", isSystem = false, level = 10, levelLabel = "", dataScope = "SELF" }) {
    const record = {
      id: `r_${this.roles.size + 1}`,
      key: key.toUpperCase(),
      name,
      description,
      isSystem,
      status: "ACTIVE",
      level,
      levelLabel,
      dataScope,
      version: 1,
      save: async function save() {
        this.version += 1;
        return this;
      },
    };
    this.roles.set(record.id, record);
    return record;
  }

  async update(id, { name, description, level, levelLabel, dataScope, expectedVersion }) {
    const role = await this.assertExists(id);
    this.assertVersion(role, expectedVersion);
    if (name !== undefined) role.name = name.trim();
    if (description !== undefined) role.description = description.trim();
    if (level !== undefined) role.level = level;
    if (levelLabel !== undefined) role.levelLabel = levelLabel;
    if (dataScope !== undefined) role.dataScope = dataScope;
    role.version += 1;
    return role;
  }

  async setStatus(id, status, expectedVersion) {
    const role = await this.assertExists(id);
    this.assertVersion(role, expectedVersion);
    role.status = status;
    role.version += 1;
    return role;
  }

  assertVersion(role, expectedVersion) {
    if (expectedVersion !== undefined && role.version !== expectedVersion) {
      const { ConflictError } = require("../../src/domain/errors");
      throw new ConflictError(
        `Role "${role.key}" was modified by another administrator. Reload and retry.`,
        "OPTIMISTIC_LOCK_CONFLICT"
      );
    }
  }

  async findByIds(ids) {
    const set = new Set(ids.map(String));
    return [...this.roles.values()].filter((r) => set.has(r.id));
  }

  async findByKey(key) {
    for (const role of this.roles.values()) {
      if (role.key === key.toUpperCase()) return role;
    }
    return null;
  }

  async findActiveByIds(ids) {
    const set = new Set(ids.map(String));
    return [...this.roles.values()].filter(
      (r) => set.has(r.id) && r.status === "ACTIVE"
    );
  }

  async listAll() {
    return [...this.roles.values()];
  }

  async listActive() {
    return [...this.roles.values()].filter((r) => r.status === "ACTIVE");
  }

  async assertExists(id) {
    const role = this.roles.get(String(id));
    if (!role) {
      const { NotFoundError } = require("../../src/domain/errors");
      throw new NotFoundError("Role not found.", "ROLE_NOT_FOUND");
    }
    return role;
  }
}

class InMemoryPermissionRepository {
  constructor() {
    this.rolePermissions = new Map(); // roleId -> Set<key>
    this.definitions = []; // { key, module, description }
  }

  assign(roleId, keys) {
    if (!this.rolePermissions.has(String(roleId))) {
      this.rolePermissions.set(String(roleId), new Set());
    }
    for (const key of keys) this.rolePermissions.get(String(roleId)).add(key);
  }

  seedDefinitions(definitions) {
    this.definitions = definitions;
  }

  async listAll() {
    return this.definitions.map((d) => ({ ...d }));
  }

  async syncDefinitions() {}

  async permissionKeysForRoles(roleIds) {
    const result = new Set();
    for (const roleId of roleIds) {
      for (const key of this.rolePermissions.get(String(roleId)) ?? []) {
        result.add(key);
      }
    }
    return result;
  }

  async permissionKeysForRole(roleId) {
    return new Set(this.rolePermissions.get(String(roleId)) ?? []);
  }

  async applyDiffToRole(roleId, { added, removed }, grantedBy = null) {
    if (!this.rolePermissions.has(String(roleId))) {
      this.rolePermissions.set(String(roleId), new Set());
    }
    const set = this.rolePermissions.get(String(roleId));
    for (const key of removed) set.delete(key);
    for (const key of added) set.add(key);
  }

  async assignToRole(roleId, keys) {
    if (!this.rolePermissions.has(String(roleId))) {
      this.rolePermissions.set(String(roleId), new Set());
    }
    for (const key of keys) this.rolePermissions.get(String(roleId)).add(key);
  }

  async replaceForRole() {}
}

class InMemoryRolePermissionRepository {
  constructor() {
    this.rows = []; // { roleId, permissionKey }
  }

  assign(roleId, keys) {
    for (const key of keys) {
      this.rows.push({ roleId: String(roleId), permissionKey: key });
    }
  }

  async listAll() {
    return this.rows.map((r) => ({ roleId: r.roleId, permissionKey: r.permissionKey }));
  }
}

class InMemoryUserRoleRepository {
  constructor() {
    this.rows = []; // { userId, roleId }
  }

  assign(userId, roleIds) {
    this.rows = this.rows.filter((r) => r.userId !== String(userId));
    for (const roleId of roleIds) this.rows.push({ userId: String(userId), roleId: String(roleId) });
  }

  async findByUserId(userId) {
    return this.rows
      .filter((r) => r.userId === String(userId))
      .map((r) => ({ roleId: r.roleId }));
  }

  async roleIdsForUser(userId) {
    return this.rows
      .filter((r) => r.userId === String(userId))
      .map((r) => r.roleId);
  }

  async replaceRolesForUser(userId, roleIds, assignedBy = null) {
    this.rows = this.rows.filter((r) => r.userId !== String(userId));
    for (const roleId of roleIds) {
      this.rows.push({ userId: String(userId), roleId: String(roleId), assignedBy });
    }
    // Mirror the role refs onto the user document (matches the real repo).
    if (this.userStore) {
      const user = this.userStore.get(String(userId));
      if (user) user.roleIds = roleIds.map(String);
    }
  }

  async userIdsForRole(roleId) {
    return [
      ...new Set(
        this.rows
          .filter((r) => r.roleId === String(roleId))
          .map((r) => String(r.userId))
      ),
    ];
  }

  async userRolePairsForRoleIds(roleIds) {
    const set = new Set(roleIds.map(String));
    return this.rows
      .filter((r) => set.has(String(r.roleId)))
      .map((r) => ({ userId: String(r.userId), roleId: String(r.roleId) }));
  }
}

class InMemorySessionRepository {
  constructor() {
    this.sessions = new Map();
  }

  async create({ sessionId, userId, refreshTokenHash, device, expiresAt }) {
    const session = {
      sessionId,
      userId: String(userId),
      refreshTokenHash,
      device,
      issuedAt: new Date(),
      lastActivityAt: new Date(),
      expiresAt,
      revokedAt: null,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async findById(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  async findByUserId(userId) {
    return [...this.sessions.values()].filter(
      (s) => s.userId === String(userId) && s.revokedAt === null
    );
  }

  async touchActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivityAt = new Date();
  }

  async revoke(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = new Date();
  }

  async revokeAllForUser(userId) {
    const sessions = [...this.sessions.values()].filter(
      (s) => s.userId === String(userId) && s.revokedAt === null
    );
    for (const s of sessions) s.revokedAt = new Date();
    return sessions.length;
  }
}

class InMemoryRefreshTokenRepository {
  constructor() {
    this.tokens = new Map(); // hash -> doc
  }

  async create({ tokenHash, userId, sessionId, familyId, expiresAt }) {
    const doc = {
      tokenHash,
      userId: String(userId),
      sessionId,
      familyId,
      usedAt: null,
      expiresAt,
      revokedAt: null,
    };
    this.tokens.set(tokenHash, doc);
    return doc;
  }

  async findByHash(tokenHash) {
    return this.tokens.get(tokenHash) ?? null;
  }

  async markUsed(tokenDoc) {
    if (tokenDoc.usedAt || tokenDoc.revokedAt) return false;
    tokenDoc.usedAt = new Date();
    return true;
  }

  async revokeFamily(familyId) {
    for (const doc of this.tokens.values()) {
      if (doc.familyId === familyId) doc.revokedAt = new Date();
    }
  }

  async revokeBySession(sessionId) {
    for (const doc of this.tokens.values()) {
      if (doc.sessionId === sessionId && !doc.revokedAt) {
        doc.revokedAt = new Date();
      }
    }
  }

  async revokeBySessions(sessionIds) {
    const set = new Set(sessionIds);
    for (const doc of this.tokens.values()) {
      if (set.has(doc.sessionId) && !doc.revokedAt) {
        doc.revokedAt = new Date();
      }
    }
  }
}

class InMemoryRoutingRuleRepository {
  constructor() {
    this.rules = new Map();
  }

  async getByType(requestType) {
    return this.rules.get(requestType) ?? null;
  }

  async listAll() {
    return [...this.rules.values()];
  }

  async upsert(rule, updatedBy = null) {
    const stored = { ...rule, updatedBy, updatedAt: new Date() };
    this.rules.set(rule.requestType, stored);
    return stored;
  }
}

class InMemoryRequestRepository {
  constructor() {
    this.requests = new Map();
    this.nextId = 1;
  }

  async create({ type, requesterId, payload, status = "DRAFT" }) {
    const id = `req_${this.nextId++}`;
    const request = {
      id,
      type,
      requesterId: String(requesterId),
      payload: payload ?? {},
      status,
      approverId: null,
      cancellationReason: null,
      submittedAt: null,
      decidedAt: null,
      cancelledAt: null,
      version: 1,
    };
    this.requests.set(id, request);
    return request;
  }

  async findById(id) {
    return this.requests.get(id) ?? null;
  }

  /** FR-001: APPROVED LEAVE requests overlapping [from, to] for a requester. */
  async findApprovedLeaveCovering({ requesterId, from, to }) {
    return [...this.requests.values()].filter(
      (r) =>
        String(r.requesterId) === String(requesterId) &&
        r.type === "LEAVE" &&
        r.status === "APPROVED" &&
        r.payload?.startDate &&
        r.payload?.endDate &&
        r.payload.startDate <= to &&
        r.payload.endDate >= from
    );
  }

  async findScoped(id, requesterId) {
    const request = this.requests.get(id);
    return request && String(request.requesterId) === String(requesterId)
      ? request
      : null;
  }

  async findByRequesterId(requesterId, { status, type, from, to, page = 1, pageSize = 20 } = {}) {
    let items = [...this.requests.values()].filter(
      (r) => String(r.requesterId) === String(requesterId)
    );
    if (status) items = items.filter((r) => r.status === status);
    if (type) items = items.filter((r) => r.type === type);
    items.sort((a, b) => new Date(b.submittedAt ?? 0) - new Date(a.submittedAt ?? 0));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async updateStatus(id, { toStatus, version, fields = {} }) {
    const request = this.requests.get(id);
    if (!request || request.version !== version) {
      const { ConflictError } = require("../../src/domain/errors");
      throw new ConflictError(
        "The request was modified concurrently.",
        "REQUEST_VERSION_CONFLICT"
      );
    }
    request.status = toStatus;
    request.version += 1;
    Object.assign(request, fields);
    return request;
  }

  async claimForUser(id, userId) {
    const request = this.requests.get(id);
    if (
      !request ||
      request.status !== "PENDING" ||
      request.approval?.targetType !== "ROLE" ||
      request.approval?.assignedUserId != null
    ) {
      return null;
    }
    request.approval = {
      ...(request.approval ?? {}),
      assignedUserId: userId,
      assignedAt: new Date(),
    };
    request.approverId = userId;
    request.version += 1;
    return request;
  }

  async countPendingForUserIds(userIds, type) {
    if (!userIds || userIds.length === 0) return 0;
    const set = new Set(userIds.map(String));
    return [...this.requests.values()].filter(
      (r) =>
        r.status === "PENDING" &&
        set.has(String(r.requesterId)) &&
        (!type || r.type === type)
    ).length;
  }

  async countSummaryForUser(requesterId) {
    const all = [...this.requests.values()].filter(
      (r) => String(r.requesterId) === String(requesterId)
    );
    const count = (status) => all.filter((r) => r.status === status).length;
    const byType = { leave: 0, overtime: 0, trip: 0 };
    for (const r of all) {
      const key = String(r.type).toLowerCase();
      if (byType[key] !== undefined) byType[key] += 1;
    }
    return {
      pending: count("PENDING"),
      approved: count("APPROVED"),
      rejected: count("REJECTED"),
      cancelled: count("CANCELLED"),
      byType,
    };
  }

  async findRecentDecisions({ limit = 5 } = {}) {
    return [...this.requests.values()]
      .filter((r) => ["APPROVED", "REJECTED"].includes(r.status) && r.decidedAt)
      .sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt))
      .slice(0, limit);
  }

  async findWithFilters({ requesterId, approverId, status, type, from, to, page = 1, pageSize = 20, extra = {} } = {}, { field = "submittedAt" } = {}) {
    const matchIn = (value, key, item) => {
      if (value && typeof value === "object" && "$in" in value) {
        return value.$in.map(String).includes(String(item[key]));
      }
      return String(item[key]) === String(value);
    };
    let items = [...this.requests.values()];
    if (requesterId) items = items.filter((item) => matchIn(requesterId, "requesterId", item));
    if (approverId) items = items.filter((item) => matchIn(approverId, "approverId", item));
    if (status) items = items.filter((item) => matchIn(status, "status", item));
    if (type) items = items.filter((r) => r.type === type);
    if (from) items = items.filter((r) => r[field] && new Date(r[field]) >= new Date(from));
    if (to) items = items.filter((r) => r[field] && new Date(r[field]) <= new Date(to));
    for (const [key, value] of Object.entries(extra)) {
      items = items.filter((r) => {
        if (value && typeof value === "object" && "$in" in value) {
          return value.$in.map(String).includes(String(r[key]));
        }
        if (key.startsWith("payload.")) {
          return r.payload?.[key.slice("payload.".length)] === value;
        }
        if (key.startsWith("decision.")) {
          return r.decision?.[key.slice("decision.".length)] === value;
        }
        return r[key] === value;
      });
    }
    items.sort((a, b) => new Date(b[field] ?? 0) - new Date(a[field] ?? 0));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async findByApprover(approverId, { status, type, page = 1, pageSize = 20 } = {}) {
    let items = [...this.requests.values()].filter(
      (r) => String(r.approverId) === String(approverId)
    );
    if (status) items = items.filter((r) => r.status === status);
    if (type) items = items.filter((r) => r.type === type);
    items.sort((a, b) => new Date(b.submittedAt ?? 0) - new Date(a.submittedAt ?? 0));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async findByDecidedBy(actorId, { type, page = 1, pageSize = 20 } = {}) {
    let items = [...this.requests.values()].filter(
      (r) =>
        r.decision &&
        String(r.decision.actorId) === String(actorId) &&
        ["APPROVED", "REJECTED"].includes(r.status)
    );
    if (type) items = items.filter((r) => r.type === type);
    items.sort((a, b) => new Date(b.decidedAt ?? 0) - new Date(a.decidedAt ?? 0));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }
}

class InMemoryRequestEventRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async append({ requestId, event, actorId = null, comment = "", fromStatus = "", toStatus, actorNameSnapshot = null, actorRoleId = null, actorRoleNameSnapshot = null }) {
    const entry = {
      id: `reqevt_${this.nextId++}`,
      requestId,
      event,
      actorId,
      actorNameSnapshot,
      actorRoleId,
      actorRoleNameSnapshot,
      comment,
      fromStatus,
      toStatus,
      recordedAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findByRequestId(requestId) {
    return this.entries.filter((e) => String(e.requestId) === String(requestId));
  }
}

class InMemoryAttendanceCorrectionModel {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create(data) {
    const entry = {
      id: `corr_${this.nextId++}`,
      attendanceId: data.attendanceId,
      field: data.field,
      oldValue: data.oldValue ?? null,
      newValue: data.newValue ?? null,
      reason: data.reason,
      correctedBy: data.correctedBy ?? null,
      correctedAt: data.correctedAt ?? new Date(),
    };
    this.entries.push(entry);
    return entry;
  }
}

class InMemoryAttendanceRepository {
  constructor({ correctionModel } = {}) {
    this.records = new Map();
    this.nextId = 1;
    this.correctionModel = correctionModel;
  }

  async findByUserAndDate(userId, date) {
    for (const record of this.records.values()) {
      if (String(record.userId) === String(userId) && record.date === date) {
        return record;
      }
    }
    return null;
  }

  async create({ userId, date, clockInAt, source = "SELF", exceptionTypes = [], status = "NORMAL", punctuality = null }) {
    const id = `att_${this.nextId++}`;
    const record = {
      id,
      userId: String(userId),
      date,
      clockInAt,
      clockOutAt: null,
      status,
      punctuality,
      exceptionTypes,
      source,
      version: 1,
      save: async function save() {
        return this;
      },
    };
    this.records.set(id, record);
    return record;
  }

  async save(record) {
    this.records.set(record.id, record);
    return record;
  }

  /** FR-001: creates a LEAVE record only when none exists for {userId, date}. */
  async createLeaveIfAbsent({ userId, date }) {
    const existing = await this.findByUserAndDate(userId, date);
    if (existing) return existing;
    return this.create({
      userId,
      date,
      clockInAt: null,
      status: "LEAVE",
      punctuality: null,
    });
  }

  async applyCorrection(id, { version, fields }) {
    const record = this.records.get(id);
    if (!record || record.version !== version) {
      const { ConflictError } = require("../../src/domain/errors");
      throw new ConflictError("Modified concurrently.", "ATTENDANCE_VERSION_CONFLICT");
    }
    Object.assign(record, fields);
    record.version += 1;
    return record;
  }

  async findById(id) {
    return this.records.get(id) ?? null;
  }

  async findByIdScoped(id, userId) {
    const record = this.records.get(id);
    return record && String(record.userId) === String(userId) ? record : null;
  }

  async findByUser(userId, { from, to, status, page = 1, pageSize = 20 } = {}) {
    let items = [...this.records.values()].filter((r) => String(r.userId) === String(userId));
    if (from) items = items.filter((r) => r.date >= from);
    if (to) items = items.filter((r) => r.date <= to);
    if (status) items = items.filter((r) => r.status === status);
    items.sort((a, b) => b.date.localeCompare(a.date));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async queryOverview({ userIds, from, to, status, exception, page = 1, pageSize = 20 } = {}) {
    let items = [...this.records.values()];
    if (userIds && userIds.length > 0) {
      const set = new Set(userIds.map(String));
      items = items.filter((r) => set.has(String(r.userId)));
    }
    if (from) items = items.filter((r) => r.date >= from);
    if (to) items = items.filter((r) => r.date <= to);
    if (status) items = items.filter((r) => r.status === status);
    if (exception) items = items.filter((r) => (r.exceptionTypes ?? []).includes(exception));
    items.sort((a, b) => b.date.localeCompare(a.date));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async countOpenShiftsForUserIds(userIds) {
    if (!userIds || userIds.length === 0) return 0;
    const set = new Set(userIds.map(String));
    return [...this.records.values()].filter(
      (r) => set.has(String(r.userId)) && r.clockOutAt == null
    ).length;
  }

  async countOpenShiftsByDate(date) {
    return [...this.records.values()].filter(
      (r) => r.date === date && r.clockOutAt == null
    ).length;
  }

  async distinctUserIdsOnDate(date) {
    return [
      ...new Set(
        [...this.records.values()]
          .filter((r) => r.date === date)
          .map((r) => String(r.userId))
      ),
    ];
  }

  async countExceptionsInRange({ from, to } = {}) {
    return [...this.records.values()].filter(
      (r) =>
        r.status === "EXCEPTION" &&
        (!from || r.date >= from) &&
        (!to || r.date <= to)
    ).length;
  }

  async listCorrections(attendanceId) {
    if (!this.correctionModel) return [];
    return this.correctionModel.entries.filter(
      (c) => String(c.attendanceId) === String(attendanceId)
    );
  }
}

class InMemoryOrgRepository {
  constructor() {
    this.departments = new Map();
    this.positions = new Map();
    this.nextId = 1;
  }

  async assertNameAvailable(collection, name, ignoreId) {
    for (const doc of collection.values()) {
      if (doc.name.toLowerCase() === name.toLowerCase() && doc.id !== ignoreId) {
        const { ConflictError } = require("../../src/domain/errors");
        throw new ConflictError("Name already exists.", "ORG_DUPLICATE");
      }
    }
  }

  async createDepartment({ name, code, description, createdBy }) {
    await this.assertNameAvailable(this.departments, name, null);
    const id = `dept_${this.nextId++}`;
    const doc = { id, name, code: code ?? "", description: description ?? "", status: "ACTIVE", createdBy: createdBy ?? null };
    this.departments.set(id, doc);
    return doc;
  }

  async getDepartment(id) {
    const doc = this.departments.get(id);
    if (!doc) {
      const { NotFoundError } = require("../../src/domain/errors");
      throw new NotFoundError("Department not found.", "DEPARTMENT_NOT_FOUND");
    }
    return doc;
  }

  async updateDepartment(id, { name, code, description, updatedBy }) {
    const doc = await this.getDepartment(id);
    await this.assertNameAvailable(this.departments, name, id);
    doc.name = name;
    if (code !== undefined) doc.code = code;
    if (description !== undefined) doc.description = description;
    doc.updatedBy = updatedBy ?? null;
    return doc;
  }

  async setDepartmentStatus(id, status, updatedBy) {
    const doc = this.departments.get(id);
    if (!doc) return null;
    doc.status = status;
    doc.updatedBy = updatedBy ?? null;
    return doc;
  }

  async listDepartments() {
    return [...this.departments.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listActiveDepartments() {
    return [...this.departments.values()].filter((d) => d.status === "ACTIVE");
  }

  async createPosition({ name, description, createdBy }) {
    await this.assertNameAvailable(this.positions, name, null);
    const id = `pos_${this.nextId++}`;
    const doc = { id, name, description: description ?? "", status: "ACTIVE", createdBy: createdBy ?? null };
    this.positions.set(id, doc);
    return doc;
  }

  async getPosition(id) {
    const doc = this.positions.get(id);
    if (!doc) {
      const { NotFoundError } = require("../../src/domain/errors");
      throw new NotFoundError("Position not found.", "POSITION_NOT_FOUND");
    }
    return doc;
  }

  async updatePosition(id, { name, description, updatedBy }) {
    const doc = await this.getPosition(id);
    await this.assertNameAvailable(this.positions, name, id);
    doc.name = name;
    if (description !== undefined) doc.description = description;
    doc.updatedBy = updatedBy ?? null;
    return doc;
  }

  async setPositionStatus(id, status, updatedBy) {
    const doc = this.positions.get(id);
    if (!doc) return null;
    doc.status = status;
    doc.updatedBy = updatedBy ?? null;
    return doc;
  }

  async listPositions() {
    return [...this.positions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listActivePositions() {
    return [...this.positions.values()].filter((p) => p.status === "ACTIVE");
  }
}

class InMemoryReportingRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async append({ userId, oldManagerId = null, newManagerId = null, changedBy = null }) {
    const entry = {
      id: `rh_${this.nextId++}`,
      userId,
      oldManagerId,
      newManagerId,
      changedBy,
      changedAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async findByUserId(userId) {
    return this.entries.filter((e) => String(e.userId) === String(userId));
  }
}

class InMemoryNotificationRepository {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async create({ userId, type, title, body = "", link = "", relatedRequestId = null }) {
    const entry = {
      id: `n_${this.nextId++}`,
      userId: String(userId),
      type,
      title,
      body,
      link,
      relatedRequestId: relatedRequestId ?? null,
      readAt: null,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async listByUser(userId, { page = 1, pageSize = 20 } = {}) {
    let items = this.entries.filter((e) => String(e.userId) === String(userId));
    items.sort(
      (a, b) =>
        (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0) ||
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total };
  }

  async countUnread(userId) {
    return this.entries.filter((e) => String(e.userId) === String(userId) && !e.readAt).length;
  }

  async markRead(id, userId) {
    const entry = this.entries.find(
      (e) => e.id === id && String(e.userId) === String(userId)
    );
    if (!entry) return null;
    entry.readAt = new Date();
    return entry;
  }

  async markAllRead(userId) {
    let count = 0;
    for (const entry of this.entries) {
      if (String(entry.userId) === String(userId) && !entry.readAt) {
        entry.readAt = new Date();
        count += 1;
      }
    }
    return count;
  }
}

class InMemoryLeaveTypeRepository {
  constructor() {
    this.types = new Map();
    this.nextId = 1;
  }

  async findByKey(key) {
    const upper = String(key).toUpperCase();
    for (const type of this.types.values()) {
      if (type.key === upper) return type;
    }
    return null;
  }

  /** Null-safe id lookup (mirrors the real repository contract). */
  async findById(id) {
    return this.types.get(String(id)) ?? null;
  }

  async create(input) {
    if (await this.findByKey(input.key)) {
      const { ConflictError } = require("../../src/domain/errors");
      throw new ConflictError("Leave type exists.", "LEAVE_TYPE_EXISTS");
    }
    const id = `lt_${this.nextId++}`;
    const doc = {
      id,
      key: String(input.key).toUpperCase(),
      name: input.name,
      description: input.description ?? "",
      isBalanceBased: input.isBalanceBased ?? false,
      maxDaysPerRequest: input.maxDaysPerRequest ?? null,
      requiredSupportingInfo: input.requiredSupportingInfo ?? false,
      status: input.status ?? "ACTIVE",
      isSystem: input.isSystem ?? false,
      updatedBy: input.updatedBy ?? null,
    };
    this.types.set(id, doc);
    return doc;
  }

  async getById(id) {
    const doc = this.types.get(id);
    if (!doc) {
      const { NotFoundError } = require("../../src/domain/errors");
      throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    }
    return doc;
  }

  async update(id, input) {
    const doc = await this.getById(id);
    Object.assign(doc, input);
    return doc;
  }

  async setStatus(id, status, updatedBy) {
    const doc = this.types.get(id);
    if (!doc) return null;
    doc.status = status;
    doc.updatedBy = updatedBy ?? null;
    return doc;
  }

  async listAll() {
    return [...this.types.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async listActive() {
    return [...this.types.values()].filter((t) => t.status === "ACTIVE");
  }
}

class InMemoryApprovalConfigurationRepository {
  constructor() {
    this.configs = new Map(); // requestType -> config doc
  }

  async getByType(requestType) {
    const doc = this.configs.get(requestType);
    return doc ? { ...doc } : null;
  }

  async listAll() {
    return [...this.configs.values()].map((doc) => ({ ...doc }));
  }

  async upsert(input, updatedBy = null) {
    const existing = this.configs.get(input.requestType);
    const next = {
      requestType: input.requestType,
      roles: input.roles ?? [],
      selfApproval: input.selfApproval === true,
      updatedBy: updatedBy ?? null,
      version: existing ? existing.version + 1 : 1,
    };
    this.configs.set(input.requestType, next);
    return { ...next };
  }
}

function buildFakes() {
  const auditRepository = new InMemoryAuditEventRepository();
  const activityRepository = new InMemoryActivityLogRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const permissionRepository = new InMemoryPermissionRepository();
  const rolePermissionRepository = new InMemoryRolePermissionRepository();
  const platformSettingRepository = new InMemoryPlatformSettingRepository();
  const attendanceCorrectionModel = new InMemoryAttendanceCorrectionModel();
  const attendanceRepository = new InMemoryAttendanceRepository({
    correctionModel: attendanceCorrectionModel,
  });

  const publisher = new InMemoryAuditPublisher({
    auditRepository,
    activityRepository,
    chainSalt: "test-salt",
  });

  const userRepository = new InMemoryUserRepository();
  const userRoleRepository = new InMemoryUserRoleRepository();
  // Mirror role refs onto user docs (matches the real repository behavior).
  userRoleRepository.userStore = userRepository.users;

  return {
    auditRepository,
    activityRepository,
    outboxRepository,
    platformSettingRepository,
    requestRepository: new InMemoryRequestRepository(),
    requestEventRepository: new InMemoryRequestEventRepository(),
    routingRuleRepository: new InMemoryRoutingRuleRepository(),
    attendanceRepository,
    attendanceCorrectionModel,
    orgRepository: new InMemoryOrgRepository(),
    reportingRepository: new InMemoryReportingRepository(),
    notificationRepository: new InMemoryNotificationRepository(),
    leaveTypeRepository: new InMemoryLeaveTypeRepository(),
    publisher,
    // Back-compat alias for the few callers that still inspect raw inserts.
    legacyAudit: new InMemoryAuditRepository(),
    userRepository: new InMemoryUserRepository(),
    roleRepository: new InMemoryRoleRepository(),
    permissionRepository,
    rolePermissionRepository,
    userRoleRepository,
    sessionRepository: new InMemorySessionRepository(),
    refreshTokenRepository: new InMemoryRefreshTokenRepository(),
    approvalConfigurationRepository: new InMemoryApprovalConfigurationRepository(),
  };
}

module.exports = { buildFakes };
