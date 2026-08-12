/**
 * CalendarService (FR-059) — company holidays + working-day calendar.
 *
 * Reads the company timezone (`companyTimezoneOffsetMs`, defaulting to UTC)
 * from platform settings and exposes holiday CRUD (audited), the active
 * working-day calendar, and an `isWorkingDay` predicate used by leave
 * day-counting. Holidays are persisted as UTC instants of local midnight.
 */

const { validateHoliday, isWeekend, isWorkingDay } = require("../domain/calendar");
const {
  fromWorkDay,
  toWorkDay,
  assertDateKey,
} = require("../domain/timezone.helper");
const { ValidationError, NotFoundError } = require("../domain/errors");

class CalendarService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/holiday.repository').HolidayRepository} deps.holidayRepository
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({ holidayRepository, platformSettingRepository, auditService }) {
    this.holidayRepository = holidayRepository;
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
  }

  /** Reads the company timezone offset from platform settings (default UTC). */
  async getTimezone() {
    const offset = await this.platformSettingRepository.get("companyTimezoneOffsetMs");
    return { offsetMs: typeof offset === "number" && Number.isFinite(offset) ? offset : 0 };
  }

  /** Active holidays within an inclusive date-key range. */
  async listHolidays({ from, to }) {
    const { offsetMs } = await this.getTimezone();
    const holidays = await this.holidayRepository.listActiveBetween(
      fromWorkDay(from, offsetMs),
      fromWorkDay(to, offsetMs)
    );
    return holidays.map((holiday) => this.toDto(holiday, offsetMs));
  }

  /** Alias used by leave day-counting to fetch the holiday set for a range. */
  async getHolidaysBetween(from, to) {
    return this.listHolidays({ from, to });
  }

  /** Active holidays + weekend days in a range (FR-059 calendar view). */
  async getWorkingDayCalendar({ from, to }) {
    assertDateKey(from);
    assertDateKey(to);
    if (from > to) {
      throw new ValidationError("from must be on or before to.", { field: "from" });
    }
    const { offsetMs } = await this.getTimezone();
    const fromDate = fromWorkDay(from, offsetMs);
    const toDate = fromWorkDay(to, offsetMs);

    const holidays = await this.holidayRepository.listActiveBetween(fromDate, toDate);
    const holidayKeys = new Set(holidays.map((h) => toWorkDay(h.date, offsetMs)));

    const weekendDays = [];
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const key = toWorkDay(cursor, offsetMs);
      if (isWeekend(key) && !holidayKeys.has(key)) weekendDays.push(key);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      from,
      to,
      holidays: holidays.map((holiday) => this.toDto(holiday, offsetMs)),
      weekendDays,
    };
  }

  /**
   * True when a date key is a working day (holidays + weekends off) for the
   * company timezone — used by leave day-count.
   *
   * @param {string} date date key ("YYYY-MM-DD")
   */
  async isWorkingDay(date) {
    assertDateKey(date);
    const { offsetMs } = await this.getTimezone();
    const dayStart = fromWorkDay(date, offsetMs);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const holidays = await this.holidayRepository.listActiveBetween(dayStart, dayEnd);
    return isWorkingDay(date, { holidays, useWeekends: true });
  }

  async createHoliday(input, actor = {}) {
    const data = validateHoliday(input);
    const { offsetMs } = await this.getTimezone();
    const holiday = await this.holidayRepository.create({
      date: fromWorkDay(data.date, offsetMs),
      name: data.name,
      repeatYearly: data.repeatYearly,
      updatedBy: actor.actorId ?? null,
    });
    await this.auditService.record({
      action: "CALENDAR.HOLIDAY_CREATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "HOLIDAY",
        id: String(holiday.id ?? holiday._id),
        summary: holiday.name,
      },
      outcome: "SUCCESS",
      metadata: { date: data.date, name: data.name, repeatYearly: data.repeatYearly },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(holiday, offsetMs);
  }

  async updateHoliday(id, input = {}, actor = {}) {
    const current = await this.holidayRepository.getById(id);
    const { offsetMs } = await this.getTimezone();
    const currentDateKey = toWorkDay(current.date, offsetMs);
    const nextDateKey = input.date !== undefined ? input.date : currentDateKey;
    const next = {
      name: input.name !== undefined ? input.name : current.name,
      repeatYearly:
        input.repeatYearly !== undefined
          ? input.repeatYearly
          : (current.repeatYearly ?? false),
      updatedBy: actor.actorId ?? null,
    };
    if (input.date !== undefined) {
      next.date = fromWorkDay(input.date, offsetMs);
    }
    validateHoliday({ date: nextDateKey, name: next.name, repeatYearly: next.repeatYearly });

    const updated = await this.holidayRepository.update(id, next);
    await this.auditService.record({
      action: "CALENDAR.HOLIDAY_UPDATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "HOLIDAY",
        id: String(updated.id ?? updated._id),
        summary: updated.name,
      },
      outcome: "SUCCESS",
      metadata: { date: nextDateKey, name: next.name, repeatYearly: next.repeatYearly },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toDto(updated, offsetMs);
  }

  async deactivateHoliday(id, actor = {}) {
    const updated = await this.holidayRepository.setStatus(id, "INACTIVE", actor.actorId ?? null);
    if (!updated) {
      throw new NotFoundError("Holiday not found.", "HOLIDAY_NOT_FOUND");
    }
    await this.auditService.record({
      action: "CALENDAR.HOLIDAY_DEACTIVATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "HOLIDAY",
        id: String(updated.id ?? updated._id),
        summary: updated.name,
      },
      outcome: "SUCCESS",
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    const { offsetMs } = await this.getTimezone();
    return this.toDto(updated, offsetMs);
  }

  async activateHoliday(id, actor = {}) {
    const updated = await this.holidayRepository.setStatus(id, "ACTIVE", actor.actorId ?? null);
    if (!updated) {
      throw new NotFoundError("Holiday not found.", "HOLIDAY_NOT_FOUND");
    }
    await this.auditService.record({
      action: "CALENDAR.HOLIDAY_ACTIVATED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "HOLIDAY",
        id: String(updated.id ?? updated._id),
        summary: updated.name,
      },
      outcome: "SUCCESS",
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    const { offsetMs } = await this.getTimezone();
    return this.toDto(updated, offsetMs);
  }

  /** Renders a holiday record as a timezone-aware date key. */
  toDto(holiday, offsetMs = 0) {
    return {
      id: String(holiday.id ?? holiday._id),
      date: toWorkDay(holiday.date, offsetMs),
      name: holiday.name,
      repeatYearly: holiday.repeatYearly ?? false,
      status: holiday.status,
    };
  }
}

module.exports = { CalendarService };
