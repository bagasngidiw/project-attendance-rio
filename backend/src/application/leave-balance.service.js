/**
 * LeaveBalanceService (FR-022) — leave entitlements and balance visibility.
 *
 * Reads a user's derived balances (joined with active leave types), lets HR
 * adjust entitlements/adjustments (audited as LEAVE.BALANCE_ADJUSTED), and
 * keeps balances in sync with the request lifecycle via the EventBus:
 *
 *   request.submitted (leave)  -> reserve requested business days
 *   request.cancelled (leave)  -> release the reservation
 *   request.decided  (leave)   -> APPROVED: reserved -> consumed
 *                                 REJECTED: release the reservation
 *
 * Requested days are counted as business days using the injected calendar
 * service's holiday list; without a calendar service a raw inclusive day diff
 * is used as a fallback.
 */

const { computeBalance, assertYear, validateAdjustment } = require("../domain/leave-balance");
const { countBusinessDays } = require("../domain/calendar");
const { NotFoundError, ValidationError, ConflictError } = require("../domain/errors");

class LeaveBalanceService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/leave-balance.repository').LeaveBalanceRepository} deps.leaveBalanceRepository
   * @param {import('../infrastructure/repositories/leave-type.repository').LeaveTypeRepository} deps.leaveTypeRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('./calendar.service').CalendarService} [deps.calendarService]
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    leaveBalanceRepository,
    leaveTypeRepository,
    requestRepository,
    calendarService = null,
    auditService,
  }) {
    this.leaveBalanceRepository = leaveBalanceRepository;
    this.leaveTypeRepository = leaveTypeRepository;
    this.requestRepository = requestRepository;
    this.calendarService = calendarService;
    this.auditService = auditService;
  }

  /** Balances for a user's year, joined with ACTIVE leave-type metadata. */
  async getBalancesForUser(userId, year) {
    const y = assertYear(year);
    const [types, records] = await Promise.all([
      this.leaveTypeRepository.listActive(),
      this.leaveBalanceRepository.listByUser(userId, y),
    ]);
    const recordByType = new Map(records.map((record) => [String(record.leaveTypeId), record]));
    return types.map((type) =>
      this.buildItem(type, recordByType.get(String(type.id ?? type._id)) ?? null, y)
    );
  }

  /** Active balance-based leave types (isBalanceBased = true). */
  async listBalanceBasedTypes() {
    const types = await this.leaveTypeRepository.listActive();
    return types.filter((type) => type.isBalanceBased === true);
  }

  /**
   * Initializes the entitlement for a NEW user's balance row (TODO.md FR-001).
   * No-op when the row already exists; the create flow audits via USER.CREATED
   * (no separate LEAVE.QUOTA_ADJUSTED event here).
   */
  async ensureEntitlement({ userId, leaveTypeId, year, entitlementDays = 0 }) {
    const y = assertYear(year);
    const existing = await this.leaveBalanceRepository.findByUserAndType(userId, leaveTypeId, y);
    if (existing) return existing;
    const record = await this.leaveBalanceRepository.upsert(userId, leaveTypeId, y, {
      entitlementDays,
      adjustmentDays: 0,
      consumedDays: 0,
      reservedDays: 0,
    });
    return record;
  }

  /**
   * Sets the allocated entitlement for a user/type/year (TODO.md FR-002).
   * Preserves consumed/reserved; the remaining balance must stay >= 0 unless
   * an explicit override is given (override is route-gated by
   * `leave:manage_balances`). Emits LEAVE.QUOTA_ADJUSTED with the full trace.
   *
   * @param {{ userId: string, leaveTypeId: string, year: number, entitlementDays: number, reason: string, override?: boolean, actor?: object }} input
   */
  async setEntitlement({ userId, leaveTypeId, year, entitlementDays, reason, override = false, actor = {} }) {
    const y = assertYear(year);
    if (!Number.isInteger(entitlementDays) || entitlementDays < 0 || entitlementDays > 365) {
      throw new ValidationError("Jatah cuti harus bilangan bulat 0..365.", {
        field: "jatahCuti",
      });
    }
    if (!String(reason ?? "").trim()) {
      throw new ValidationError("Alasan perubahan jatah cuti wajib diisi.", {
        field: "reason",
      });
    }
    const type = await this.leaveTypeRepository.getById(leaveTypeId);
    if (!type) {
      throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    }
    const existing = await this.leaveBalanceRepository.findByUserAndType(userId, leaveTypeId, y);
    // computeBalance returns the remaining number (entitlement+adjustment-
    // consumed-reserved); allocated = entitlement + adjustment.
    const previousQuota = (existing?.entitlementDays ?? 0) + (existing?.adjustmentDays ?? 0);
    const previousRemaining = existing ? computeBalance(existing) : entitlementDays;

    const record = existing
      ? await this.leaveBalanceRepository.adjust(userId, leaveTypeId, y, {
          deltaEntitlement: entitlementDays - (existing.entitlementDays ?? 0),
        })
      : await this.leaveBalanceRepository.upsert(userId, leaveTypeId, y, {
          entitlementDays,
          adjustmentDays: 0,
          consumedDays: 0,
          reservedDays: 0,
        });

    const nextRemaining = computeBalance(record);
    if (nextRemaining < 0 && !override) {
      throw new ConflictError(
        `Jatah cuti tidak dapat dikurangi karena sisa akan negatif (sisa: ${previousRemaining} hari). Gunakan override dengan alasan yang jelas.`,
        "LEAVE_QUOTA_NEGATIVE"
      );
    }

    await this.auditService.record({
      action: "LEAVE.QUOTA_ADJUSTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "LEAVE_BALANCE",
        id: String(record.id ?? record._id),
        summary: `${type.key} ${y}`,
      },
      outcome: "SUCCESS",
      metadata: {
        userId,
        leaveTypeId,
        year: y,
        previousQuota,
        newQuota: entitlementDays,
        differenceDays: entitlementDays - previousQuota,
        reason,
        override,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.buildItem(type, record, y);
  }

  /** Single balance for a user / leave type / year. */
  async getBalanceForUser(userId, leaveTypeId, year) {
    const y = assertYear(year);
    const [type, record] = await Promise.all([
      this.leaveTypeRepository.getById(leaveTypeId),
      this.leaveBalanceRepository.findByUserAndType(userId, leaveTypeId, y),
    ]);
    return this.buildItem(type, record ?? null, y);
  }

  /**
   * HR adjustment to a balance (guard: leave:manage_balances at the route).
   * The delta is applied to adjustmentDays so entitlements stay intact.
   *
   * @param {{ userId: string, leaveTypeId: string, year: number, deltaDays: number, reason: string, actor: object }} input
   */
  async adjustBalance({ userId, leaveTypeId, year, deltaDays, reason, actor = {} }) {
    validateAdjustment({ deltaDays, reason, year });
    const type = await this.leaveTypeRepository.getById(leaveTypeId);
    if (!type) {
      throw new NotFoundError("Leave type not found.", "LEAVE_TYPE_NOT_FOUND");
    }
    const updated = await this.leaveBalanceRepository.adjust(userId, leaveTypeId, year, {
      deltaAdjustment: deltaDays,
    });
    await this.auditService.record({
      action: "LEAVE.BALANCE_ADJUSTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "LEAVE_BALANCE",
        id: String(updated.id ?? updated._id),
        summary: `${type.key} ${year}`,
      },
      outcome: "SUCCESS",
      metadata: { userId, leaveTypeId, year, deltaDays, reason },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.buildItem(type, updated, year);
  }

  /** Creates a zero balance row for the triple when none exists yet. */
  async ensureBalance(userId, leaveTypeId, year) {
    const existing = await this.leaveBalanceRepository.findByUserAndType(
      userId,
      leaveTypeId,
      year
    );
    if (existing) return existing;
    return this.leaveBalanceRepository.upsert(userId, leaveTypeId, year, {
      entitlementDays: 0,
      adjustmentDays: 0,
      consumedDays: 0,
      reservedDays: 0,
    });
  }

  /* ---------------- Request lifecycle integration ---------------- */

  /** Subscribes to the request workflow events (mirrors NotificationService). */
  subscribeToEvents(eventBus) {
    eventBus.subscribe("request.submitted", (payload) => this.onRequestSubmitted(payload));
    eventBus.subscribe("request.cancelled", (payload) => this.onRequestCancelled(payload));
    eventBus.subscribe("request.decided", (payload) => this.onRequestDecided(payload));
  }

  isLeaveEvent(payload) {
    return String(payload?.type ?? "").toUpperCase() === "LEAVE";
  }

  /** request.submitted: reserve the requested business days. */
  async onRequestSubmitted(payload = {}) {
    if (!this.isLeaveEvent(payload)) return;
    const leavePayload = payload.payload ?? {};
    const leaveTypeId = await this.resolveLeaveTypeId(leavePayload);
    const year = yearOf(leavePayload.startDate);
    const days = await this.computeRequestedDays(leavePayload.startDate, leavePayload.endDate);
    if (!leaveTypeId || year == null || days == null || days <= 0) return;
    await this.leaveBalanceRepository.adjust(String(payload.requesterId), leaveTypeId, year, {
      deltaReserved: days,
    });
  }

  /** request.cancelled: release the reservation. */
  async onRequestCancelled(payload = {}) {
    if (!this.isLeaveEvent(payload)) return;
    const request = await this.loadRequest(payload.requestId);
    if (!request) return;
    const leavePayload = request.payload ?? {};
    const leaveTypeId = await this.resolveLeaveTypeId(leavePayload);
    const year = yearOf(leavePayload.startDate);
    const days = await this.computeRequestedDays(leavePayload.startDate, leavePayload.endDate);
    if (!leaveTypeId || year == null || days == null || days <= 0) return;
    await this.leaveBalanceRepository.adjust(String(request.requesterId), leaveTypeId, year, {
      deltaReserved: -days,
    });
  }

  /** request.decided: APPROVED converts reserved -> consumed; REJECTED releases. */
  async onRequestDecided(payload = {}) {
    if (!this.isLeaveEvent(payload)) return;
    const request = await this.loadRequest(payload.requestId);
    if (!request) return;
    const leavePayload = request.payload ?? {};
    const leaveTypeId = await this.resolveLeaveTypeId(leavePayload);
    const year = yearOf(leavePayload.startDate);
    const days = await this.computeRequestedDays(leavePayload.startDate, leavePayload.endDate);
    if (!leaveTypeId || year == null || days == null || days <= 0) return;

    if (payload.toStatus === "APPROVED") {
      await this.leaveBalanceRepository.adjust(String(request.requesterId), leaveTypeId, year, {
        deltaReserved: -days,
        deltaConsumed: days,
      });
    } else if (payload.toStatus === "REJECTED") {
      await this.leaveBalanceRepository.adjust(String(request.requesterId), leaveTypeId, year, {
        deltaReserved: -days,
      });
    }
  }

  /* ---------------- Helpers ---------------- */

  async loadRequest(requestId) {
    if (!requestId) return null;
    try {
      return await this.requestRepository.findById(requestId);
    } catch {
      return null;
    }
  }

  /**
   * Resolves the leave-type id from a payload:
   *  1. `leaveTypeId` (direct id), or
   *  2. `leaveType` as an ObjectId (the current form sends `type.id`), or
   *  3. `leaveType` as a legacy key (e.g. "ANNUAL").
   * `findById` is null-safe against non-ObjectId values (CastError → null),
   * so the id-first order is safe for key strings.
   */
  async resolveLeaveTypeId(leavePayload) {
    if (leavePayload?.leaveTypeId) return String(leavePayload.leaveTypeId);
    if (leavePayload?.leaveType) {
      const value = leavePayload.leaveType;
      const type =
        (await this.leaveTypeRepository.findById(value)) ??
        (await this.leaveTypeRepository.findByKey(value));
      return type ? String(type.id ?? type._id) : null;
    }
    return null;
  }

  /**
   * Business days for a leave range using the calendar service holiday list;
   * falls back to an inclusive raw day diff when no calendar is wired or the
   * range is malformed.
   */
  async computeRequestedDays(from, to) {
    if (!from || !to) return null;
    if (this.calendarService) {
      try {
        const holidays = await this.calendarService.getHolidaysBetween(from, to);
        return countBusinessDays(from, to, { holidays, useWeekends: true });
      } catch {
        return rawDayDiff(from, to);
      }
    }
    return rawDayDiff(from, to);
  }

  buildItem(type, record, year) {
    const entitlementDays = Number(record?.entitlementDays ?? 0);
    const adjustmentDays = Number(record?.adjustmentDays ?? 0);
    const consumedDays = Number(record?.consumedDays ?? 0);
    const reservedDays = Number(record?.reservedDays ?? 0);
    return {
      leaveTypeId: String(type.id ?? type._id),
      leaveTypeKey: type.key,
      name: type.name,
      year,
      entitlementDays,
      adjustmentDays,
      consumedDays,
      reservedDays,
      balance: computeBalance({ entitlementDays, adjustmentDays, consumedDays, reservedDays }),
    };
  }
}

/** Extracts the balance year from a leave start date key. */
function yearOf(dateStr) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(String(dateStr ?? ""));
  return match ? Number(match[1]) : null;
}

/** Inclusive raw calendar-day diff between two date keys. */
function rawDayDiff(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 864e5) + 1;
}

module.exports = { LeaveBalanceService };
