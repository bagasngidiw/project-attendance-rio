/**
 * Report providers (FR-018 §2) — per-report-type data sources registered by
 * module (FR-027 extensibility). Each provider returns raw rows scoped to the
 * resolved `userIds` (company-wide when null) and enriched with the employee
 * name for the report columns.
 */

class ReportProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    this.providers.set(provider.key, provider);
  }

  get(key) {
    return this.providers.get(key) ?? null;
  }

  keys() {
    return [...this.providers.keys()];
  }
}

/** Attendance report provider (reads the attendance module store). */
class AttendanceReportProvider {
  constructor({ attendanceRepository, userRepository }) {
    this.attendanceRepository = attendanceRepository;
    this.userRepository = userRepository;
    this.key = "attendance";
  }

  async query({ userIds, filters }) {
    const { items } = await this.attendanceRepository.queryOverview({
      userIds,
      from: filters.from,
      to: filters.to,
      status: filters.status,
      page: 1,
      pageSize: 10000,
    });
    return Promise.all(
      items.map(async (item) => {
        const user = item.userId ? await this.userRepository.findById(item.userId) : null;
        return {
          employee: user?.name ?? item.userId?.toString?.() ?? item.userId,
          date: item.date,
          clockInAt: item.clockInAt ? new Date(item.clockInAt).toISOString() : null,
          clockOutAt: item.clockOutAt ? new Date(item.clockOutAt).toISOString() : null,
          status: item.status,
          exceptionTypes: (item.exceptionTypes ?? []).join(", "),
        };
      })
    );
  }
}

/** Shared base for the request-based report providers. */
class RequestReportProvider {
  constructor({
    requestRepository,
    userRepository,
    type,
    leaveTypeRepository = null,
    sicknessTypeRepository = null,
  }) {
    this.requestRepository = requestRepository;
    this.userRepository = userRepository;
    this.type = type;
    // Optional master-data repositories (FR-002): resolve leave/sickness type
    // ids to readable names. When absent the snapshot names on the payload
    // (payload.leaveTypeName / payload.sicknessTypeName) are used, falling
    // back to the raw value — existing callers/tests keep working.
    this.leaveTypeRepository = leaveTypeRepository;
    this.sicknessTypeRepository = sicknessTypeRepository;
  }

  async fetchRows({ userIds, filters }) {
    const extra = {};
    if (userIds && userIds.length > 0) {
      extra.requesterId = { $in: userIds };
    }
    if (filters.type && this.type === "LEAVE") {
      extra["payload.leaveType"] = filters.type;
    }
    const { items } = await this.requestRepository.findWithFilters({
      type: this.type,
      status: filters.status,
      from: filters.from,
      to: filters.to,
      extra,
      page: 1,
      pageSize: 10000,
    });
    return items;
  }

  async employeeName(requesterId) {
    const user = requesterId ? await this.userRepository.findById(requesterId) : null;
    return user?.name ?? requesterId?.toString?.() ?? requesterId;
  }

  /** FR-002: resolves a leave-type id/key to its display name. */
  async resolveLeaveTypeName(idOrKey) {
    if (!idOrKey) return null;
    if (this.leaveTypeRepository) {
      const type =
        (await this.leaveTypeRepository.findById(idOrKey)) ??
        (await this.leaveTypeRepository.findByKey(idOrKey));
      if (type) return type.name;
    }
    return null;
  }

  /** FR-002: resolves a sickness-type id/key to its display name. */
  async resolveSicknessTypeName(idOrKey) {
    if (!idOrKey) return null;
    if (this.sicknessTypeRepository) {
      const type =
        (await this.sicknessTypeRepository.findById(idOrKey)) ??
        (await this.sicknessTypeRepository.findByKey(idOrKey));
      if (type) return type.name;
    }
    return null;
  }

  /**
   * FR-009: approval columns — who was targeted, who was actually assigned,
   * who decided, and the rejection reason. Never raw ObjectIds; names resolved
   * from the snapshot or the user store.
   */
  async approvalColumns(item) {
    const approval = item.approval ?? {};
    const snapshot = approval.configurationSnapshot ?? {};
    const targetName =
      snapshot.targetUserName ??
      snapshot.targetRoleName ??
      (approval.targetType === "ROLE" ? "Role" : approval.targetType);

    const name = async (id) => {
      if (!id) return null;
      const user = await this.userRepository.findById(id);
      return user?.name ?? user?.username ?? String(id);
    };

    return {
      approvalTarget: targetName ?? null,
      assignedApprover: await name(approval.assignedUserId),
      approvedBy: await name(approval.approvedBy),
      rejectedBy: await name(approval.rejectedBy),
      rejectionReason: approval.rejectionReason ?? null,
    };
  }
}

class LeaveReportProvider extends RequestReportProvider {
  constructor(deps) {
    super({ ...deps, type: "LEAVE" });
    this.key = "leave";
  }

  async query({ userIds, filters }) {
    const items = await this.fetchRows({ userIds, filters });
    return Promise.all(
      items.map(async (item) => {
        const p = item.payload ?? {};
        return {
          employee: await this.employeeName(item.requesterId),
          leaveType:
            p.leaveTypeName ??
            (await this.resolveLeaveTypeName(p.leaveType)) ??
            p.leaveType,
          startDate: p.startDate,
          endDate: p.endDate,
          status: item.status,
          reason: p.reason,
          ...(await this.approvalColumns(item)),
        };
      })
    );
  }
}

/** SAKIT report provider (FR-001) — same shape as LEAVE, sickness type resolved. */
class SakitReportProvider extends RequestReportProvider {
  constructor(deps) {
    super({ ...deps, type: "SAKIT" });
    this.key = "sakit";
  }

  async query({ userIds, filters }) {
    const items = await this.fetchRows({ userIds, filters });
    return Promise.all(
      items.map(async (item) => {
        const p = item.payload ?? {};
        return {
          employee: await this.employeeName(item.requesterId),
          sicknessType:
            p.sicknessTypeName ??
            (await this.resolveSicknessTypeName(p.sicknessType)) ??
            p.sicknessType,
          startDate: p.startDate,
          endDate: p.endDate,
          status: item.status,
          reason: p.reason,
          ...(await this.approvalColumns(item)),
        };
      })
    );
  }
}

class OvertimeReportProvider extends RequestReportProvider {
  constructor(deps) {
    super({ ...deps, type: "OVERTIME" });
    this.key = "overtime";
  }

  async query({ userIds, filters }) {
    const items = await this.fetchRows({ userIds, filters });
    return Promise.all(
      items.map(async (item) => {
        const p = item.payload ?? {};
        return {
          employee: await this.employeeName(item.requesterId),
          date: p.date,
          startTime: p.startTime,
          endTime: p.endTime,
          durationHours: durationHours(p.startTime, p.endTime),
          status: item.status,
          reason: p.reason,
          ...(await this.approvalColumns(item)),
        };
      })
    );
  }
}

class TripReportProvider extends RequestReportProvider {
  constructor(deps) {
    super({ ...deps, type: "TRIP" });
    this.key = "trip";
  }

  async query({ userIds, filters }) {
    const items = await this.fetchRows({ userIds, filters });
    return Promise.all(
      items.map(async (item) => {
        const p = item.payload ?? {};
        return {
          employee: await this.employeeName(item.requesterId),
          destination: p.destination,
          startDate: p.startDate,
          endDate: p.endDate,
          status: item.status,
          purpose: p.purpose,
          ...(await this.approvalColumns(item)),
        };
      })
    );
  }
}

/** Computes overtime duration in hours from HH:MM bounds. */
function durationHours(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [sh, sm] = String(startTime).split(":").map(Number);
  const [eh, em] = String(endTime).split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return null;
  return Math.round(((eh * 60 + em - (sh * 60 + sm)) / 60) * 100) / 100;
}

/** Builds and registers all built-in providers. */
function registerReportProviders({
  registry,
  attendanceRepository,
  requestRepository,
  userRepository,
  leaveTypeRepository = null,
  sicknessTypeRepository = null,
}) {
  registry.register(new AttendanceReportProvider({ attendanceRepository, userRepository }));
  registry.register(new LeaveReportProvider({ requestRepository, userRepository, leaveTypeRepository }));
  registry.register(new OvertimeReportProvider({ requestRepository, userRepository }));
  registry.register(new TripReportProvider({ requestRepository, userRepository }));
  registry.register(new SakitReportProvider({ requestRepository, userRepository, sicknessTypeRepository }));
}

module.exports = {
  ReportProviderRegistry,
  registerReportProviders,
  durationHours,
  AttendanceReportProvider,
  LeaveReportProvider,
  OvertimeReportProvider,
  TripReportProvider,
  SakitReportProvider,
};
