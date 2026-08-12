/**
 * CalendarController (FR-059) — holidays + working-day calendar.
 * Reads are authenticated; writes are guarded by `calendar:manage_holidays`
 * at the route layer.
 */

const { ValidationError } = require("../../domain/errors");

class CalendarController {
  constructor({ calendarService }) {
    this.calendarService = calendarService;
  }

  /** GET /calendar/holidays?from=&to= */
  listHolidays = async (req, res, next) => {
    try {
      const { from, to } = this.rangeOrDefault(req.query);
      const data = await this.calendarService.listHolidays({ from, to });
      res.status(200).json({ data: { items: data, from, to } });
    } catch (err) {
      next(err);
    }
  };

  /** POST /calendar/holidays */
  createHoliday = async (req, res, next) => {
    try {
      const data = await this.calendarService.createHoliday(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PATCH /calendar/holidays/:id */
  updateHoliday = async (req, res, next) => {
    try {
      const data = await this.calendarService.updateHoliday(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /calendar/holidays/:id/deactivate */
  deactivateHoliday = async (req, res, next) => {
    try {
      const data = await this.calendarService.deactivateHoliday(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /calendar/holidays/:id/activate */
  activateHoliday = async (req, res, next) => {
    try {
      const data = await this.calendarService.activateHoliday(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /calendar/working-days?from=&to= */
  workingDays = async (req, res, next) => {
    try {
      const { from, to } = this.rangeOrDefault(req.query);
      const data = await this.calendarService.getWorkingDayCalendar({ from, to });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** Normalizes an optional from/to range, defaulting to the current year. */
  rangeOrDefault(query = {}) {
    const currentYear = new Date().getFullYear();
    const from = query.from ?? `${currentYear}-01-01`;
    const to = query.to ?? `${currentYear}-12-31`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      throw new ValidationError("from must be YYYY-MM-DD.", { field: "from" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new ValidationError("to must be YYYY-MM-DD.", { field: "to" });
    }
    if (from > to) {
      throw new ValidationError("from must be on or before to.", { field: "from" });
    }
    return { from, to };
  }

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { CalendarController };
