/**
 * PersonalDataService (FR-048) — per-user data export for compliance.
 *
 * Assembles a portable bundle of the target user's personal records from the
 * read repositories, maps every record to a plain DTO (never internal fields
 * such as password hashes), and records PERSONAL_DATA.EXPORTED. The bundle is
 * returned with a JSON serializer for file generation.
 */

const { NotFoundError } = require("../domain/errors");

class PersonalDataService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/attendance.repository').AttendanceRepository} deps.attendanceRepository
   * @param {import('../infrastructure/repositories/notification.repository').NotificationRepository} deps.notificationRepository
   * @param {object} [deps.auditRepository] reserved seam for an export ledger (optional)
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   */
  constructor({
    userRepository,
    requestRepository,
    attendanceRepository,
    notificationRepository,
    auditRepository = null,
    auditService,
    roleRepository,
    userRoleRepository,
  }) {
    this.userRepository = userRepository;
    this.requestRepository = requestRepository;
    this.attendanceRepository = attendanceRepository;
    this.notificationRepository = notificationRepository;
    this.auditRepository = auditRepository;
    this.auditService = auditService;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
  }

  /**
   * Exports every personal-data category held for one user.
   *
   * @param {object} input
   * @param {string} input.userId
   * @param {object} [input.actor] { actorId, actorRoleKeys, ip, userAgent, correlationId }
   * @returns {Promise<{ bundle: object, json: () => string }>}
   */
  async exportForUser({ userId, actor = {} }) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found.", "USER_NOT_FOUND");
    }

    const [roles, requests, attendance, notifications] = await Promise.all([
      this.resolveRoles(userId),
      this.requestRepository.findByRequesterId(userId, { page: 1, pageSize: 10000 }),
      this.attendanceRepository.findByUser(userId, { page: 1, pageSize: 10000 }),
      this.notificationRepository.listByUser(userId, { page: 1, pageSize: 10000 }),
    ]);

    const bundle = {
      profile: this.toProfile(user),
      roles: roles.map((role) => this.toRole(role)),
      requests: requests.items.map((request) => this.toRequest(request)),
      attendance: attendance.items.map((record) => this.toAttendance(record)),
      notifications: notifications.items.map((notification) =>
        this.toNotification(notification)
      ),
      exportedAt: new Date().toISOString(),
    };

    const recordCounts = {
      roles: bundle.roles.length,
      requests: bundle.requests.length,
      attendance: bundle.attendance.length,
      notifications: bundle.notifications.length,
    };

    await this.auditService.record({
      action: "PERSONAL_DATA.EXPORTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "USER", id: userId, summary: user.username },
      outcome: "SUCCESS",
      metadata: { targetUserId: userId, recordCounts },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { bundle, json: () => JSON.stringify(bundle, null, 2) };
  }

  async resolveRoles(userId) {
    const roleIds = await this.userRoleRepository.roleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    return this.roleRepository.findByIds(roleIds);
  }

  toProfile(user) {
    return {
      id: str(user.id ?? user._id),
      username: user.username,
      email: user.email,
      name: user.name,
      departmentId: str(user.departmentId),
      positionId: str(user.positionId),
    };
  }

  toRole(role) {
    return {
      id: str(role.id ?? role._id),
      key: role.key,
      name: role.name,
    };
  }

  toRequest(request) {
    return {
      id: str(request.id ?? request._id),
      type: request.type,
      status: request.status,
      payload: request.payload ?? {},
      approverId: str(request.approverId),
      submittedAt: request.submittedAt ?? null,
      decidedAt: request.decidedAt ?? null,
      createdAt: request.createdAt ?? null,
    };
  }

  toAttendance(record) {
    return {
      id: str(record.id ?? record._id),
      date: record.date ?? null,
      clockInAt: record.clockInAt ?? null,
      clockOutAt: record.clockOutAt ?? null,
      status: record.status ?? "NORMAL",
      exceptionTypes: record.exceptionTypes ?? [],
      source: record.source ?? "SELF",
    };
  }

  toNotification(notification) {
    return {
      id: str(notification.id ?? notification._id),
      type: notification.type,
      title: notification.title,
      body: notification.body ?? "",
      link: notification.link ?? "",
      relatedRequestId: str(notification.relatedRequestId),
      readAt: notification.readAt ?? null,
      createdAt: notification.createdAt ?? null,
    };
  }
}

function str(value) {
  return value === null || value === undefined ? null : String(value);
}

module.exports = { PersonalDataService };
