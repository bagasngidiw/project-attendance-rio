/**
 * UserRepository — persistence access for the User aggregate.
 */

const { UserModel, USER_STATUS } = require("../models/user.model");
const { NotFoundError, ConflictError } = require("../../domain/errors");

class UserRepository {
  async findByUsername(username) {
    return UserModel.findOne({ username: username.trim().toLowerCase() });
  }

  async findByEmail(email) {
    return UserModel.findOne({ email: email.trim().toLowerCase() });
  }

  async findById(id) {
    return UserModel.findById(id);
  }

  async create({
    username,
    email,
    name,
    passwordHash,
    status = USER_STATUS.ACTIVE,
    mustChangePassword = false,
    departmentId,
    positionId,
    managerId,
  }) {
    const existing = await UserModel.findOne({
      $or: [
        { username: username.trim().toLowerCase() },
        { email: email.trim().toLowerCase() },
      ],
    });
    if (existing) {
      throw new ConflictError(
        "A user with this username or email already exists.",
        "USER_EXISTS"
      );
    }
    return UserModel.create({
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      name,
      passwordHash,
      status,
      mustChangePassword,
      passwordChangedAt: new Date(),
      departmentId: departmentId ?? null,
      positionId: positionId ?? null,
      managerId: managerId ?? null,
    });
  }

  async save(user) {
    return user.save();
  }

  /**
   * Atomic sign-in failure bookkeeping: increments the counter and sets the
   * lockout window when the threshold is reached.
   *
   * @returns {{ user: object, locked: boolean, retryAfterMs: number }}
   */
  async recordFailedLogin(user, maxFailedAttempts, lockoutMs) {
    user.failedLoginAttempts += 1;
    let locked = false;
    let retryAfterMs = 0;

    if (user.failedLoginAttempts >= maxFailedAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutMs);
      locked = true;
      retryAfterMs = lockoutMs;
    }
    await user.save();
    return { user, locked, retryAfterMs };
  }

  async resetFailedLogin(user) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();
    return user;
  }

  async bumpTokenVersion(user) {
    user.tokenVersion += 1;
    await user.save();
    return user;
  }

  /**
   * Rotates a user's password: records the previous hash in the bounded
   * history, stamps `passwordChangedAt`, increments `passwordVersion`, and
   * sets the `mustChangePassword` flag. History is bounded by `historyLimit`
   * so reuse-prevention never grows unbounded.
   *
   * @param {object} user
   * @param {string} passwordHash new bcrypt hash
   * @param {{ mustChangePassword?: boolean, historyLimit?: number }} [opts]
   */
  async updatePassword(user, passwordHash, { mustChangePassword = false, historyLimit = 5 } = {}) {
    await this.rotatePassword(user, passwordHash, { mustChangePassword, historyLimit });
    return user;
  }

  /**
   * Resets a user's password to a temporary credential (FR-028): the user
   * must change it at next sign-in, and outstanding sessions are invalidated
   * immediately via the tokenVersion bump.
   *
   * @param {object} user
   * @param {string} temporaryHash new bcrypt hash
   * @param {{ historyLimit?: number }} [opts]
   */
  async resetPassword(user, temporaryHash, { historyLimit = 5 } = {}) {
    await this.rotatePassword(user, temporaryHash, { mustChangePassword: true, historyLimit });
    user.tokenVersion += 1;
    await user.save();
    return user;
  }

  async rotatePassword(user, passwordHash, { mustChangePassword, historyLimit }) {
    const history = [...(user.passwordHistory ?? [])];
    if (user.passwordHash) history.push(user.passwordHash);
    user.passwordHash = passwordHash;
    user.passwordHistory = history.slice(-Math.max(0, historyLimit));
    user.passwordVersion += 1;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = mustChangePassword;
    await user.save();
    return user;
  }

  /**
   * Updates mutable identity/org fields (FR-029). Email uniqueness is
   * enforced against other users.
   *
   * @param {string} id
   * @param {{ name?: string, email?: string, departmentId?: string|null, positionId?: string|null, managerId?: string|null }} fields
   */
  async update(id, { name, email, departmentId, positionId, managerId } = {}) {
    const user = await this.assertExists(id);

    if (email !== undefined && email !== "") {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await UserModel.findOne({
        email: normalizedEmail,
        _id: { $ne: id },
      });
      if (existing) {
        throw new ConflictError(
          "A user with this email already exists.",
          "USER_EXISTS"
        );
      }
      user.email = normalizedEmail;
    }
    if (name !== undefined && name !== "") user.name = name.trim();
    if (departmentId !== undefined) user.departmentId = departmentId || null;
    if (positionId !== undefined) user.positionId = positionId || null;
    if (managerId !== undefined) user.managerId = managerId || null;

    await user.save();
    return user;
  }

  /**
   * Flips a user's status (ACTIVE/INACTIVE/PENDING). Deactivation is
   * reversible; INACTIVE blocks sign-in while preserving records (FR-029).
   *
   * @param {string} id
   * @param {string} status
   */
  async setStatus(id, status) {
    const user = await this.assertExists(id);
    user.status = status;
    await user.save();
    return user;
  }

  /**
   * Paginated, filtered user list for the admin console (FR-029/FR-023).
   *
   * @param {object} filters
   * @param {string} [filters.search] free-text across name/username/email
   * @param {string} [filters.status] ACTIVE | INACTIVE | PENDING
   * @param {string} [filters.departmentId]
   * @param {string[]} [filters.userIds] pre-resolved ids (e.g. role filter)
   * @param {number} [filters.page]
   * @param {number} [filters.pageSize]
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async list({ search, status, departmentId, userIds, page = 1, pageSize = 20 } = {}) {
    if (userIds && userIds.length === 0) {
      return { items: [], total: 0 };
    }

    const filter = {};
    if (search && search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    if (status) filter.status = status;
    if (departmentId) filter.departmentId = departmentId;
    if (userIds && userIds.length) filter._id = { $in: userIds };

    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    return UserModel.find({ _id: { $in: ids } });
  }

  /**
   * FR-001: ACTIVE users by ids — used to resolve eligible approvers.
   *
   * @param {string[]} ids
   */
  async findByIdsActive(ids) {
    if (!ids || ids.length === 0) return [];
    return UserModel.find({ _id: { $in: ids }, status: "ACTIVE" }).lean();
  }

  /**
   * TODO.md §7: upserts a per-leave-type quota (allocatedDays), preserving the
   * used days already consumed.
   *
   * @param {string} userId
   * @param {{ leaveTypeId: string, allocatedDays: number }} quota
   */
  async upsertLeaveQuota(userId, { leaveTypeId, allocatedDays }) {
    return UserModel.findOneAndUpdate(
      { _id: userId, "leaveQuotas.leaveTypeId": leaveTypeId },
      { $set: { "leaveQuotas.$.allocatedDays": allocatedDays } },
      { returnDocument: "after", runValidators: true }
    ).then(async (updated) => {
      if (updated) return updated;
      return UserModel.findByIdAndUpdate(
        userId,
        { $push: { leaveQuotas: { leaveTypeId, allocatedDays, usedDays: 0 } } },
        { returnDocument: "after", runValidators: true }
      );
    });
  }

  /**
   * TODO.md §7: increments the used days for a leave type (called on LEAVE
   * approval). No-op when no quota row exists.
   *
   * @param {string} userId
   * @param {{ leaveTypeId: string, days: number }} input
   */
  async incrementLeaveQuotaUsed(userId, { leaveTypeId, days }) {
    return UserModel.findOneAndUpdate(
      { _id: userId, "leaveQuotas.leaveTypeId": leaveTypeId },
      { $inc: { "leaveQuotas.$.usedDays": days } },
      { returnDocument: "after", runValidators: true }
    );
  }

  async assertExists(id) {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new NotFoundError("User not found.", "USER_NOT_FOUND");
    }
    return user;
  }

  async listActiveUsers() {
    return UserModel.find({ status: USER_STATUS.ACTIVE }).sort({ name: 1 });
  }

  /** Count of ACTIVE users (FR-026 workforce stat). */
  async countActiveUsers() {
    return UserModel.countDocuments({ status: USER_STATUS.ACTIVE });
  }

  /** ACTIVE users grouped by department (FR-026 breakdown). */
  async countActiveByDepartment() {
    const rows = await UserModel.aggregate([
      { $match: { status: USER_STATUS.ACTIVE } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({
      departmentId: row._id ? String(row._id) : null,
      name: null, // department names arrive with FR-024
      count: row.count,
    }));
  }

  /**
   * Direct reports of a manager (FR-006 team scope). Only ACTIVE users are
   * part of an operational team; deactivated members are excluded from the
   * overview while their historical records remain intact.
   *
   * @param {string} managerId
   * @returns {Promise<object[]>} ACTIVE users whose `managerId` matches
   */
  async findDirectReports(managerId) {
    return UserModel.find({
      managerId,
      status: USER_STATUS.ACTIVE,
    }).sort({ name: 1 });
  }

  /**
   * Scoped member lookup: returns a user ONLY when they are an ACTIVE direct
   * report of the given manager. Returns null for anyone outside the manager's
   * scope so the presentation layer can answer 404 without leaking existence.
   *
   * @param {string} managerId
   * @param {string} memberId
   * @returns {Promise<object|null>}
   */
  async findDirectReportById(managerId, memberId) {
    return UserModel.findOne({
      _id: memberId,
      managerId,
      status: USER_STATUS.ACTIVE,
    });
  }

  /**
   * Counts the manager's ACTIVE direct reports (for the overview header).
   *
   * @param {string} managerId
   * @returns {Promise<number>}
   */
  async countDirectReports(managerId) {
    return UserModel.countDocuments({
      managerId,
      status: USER_STATUS.ACTIVE,
    });
  }
}

module.exports = { UserRepository, USER_STATUS };
