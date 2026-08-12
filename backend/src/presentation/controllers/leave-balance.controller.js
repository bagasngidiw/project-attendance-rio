/**
 * LeaveBalanceController (FR-022) — balance visibility + HR adjustment.
 * Self-view is guarded by `leave:view_balances`, cross-user views by
 * `leave:view_all`, and adjustments by `leave:manage_balances` (route layer).
 */

const { ValidationError } = require("../../domain/errors");

class LeaveBalanceController {
  constructor({ leaveBalanceService }) {
    this.leaveBalanceService = leaveBalanceService;
  }

  /** GET /leave/balances?year= (self) */
  getMyBalances = async (req, res, next) => {
    try {
      const year = this.parseYear(req.query.year);
      const data = await this.leaveBalanceService.getBalancesForUser(req.auth.userId, year);
      res.status(200).json({ data: { items: data, year } });
    } catch (err) {
      next(err);
    }
  };

  /** GET /leave/users/:userId/balances?year= (leave:view_all) */
  getUserBalances = async (req, res, next) => {
    try {
      const year = this.parseYear(req.query.year);
      const data = await this.leaveBalanceService.getBalancesForUser(req.params.userId, year);
      res.status(200).json({ data: { items: data, year } });
    } catch (err) {
      next(err);
    }
  };

  /** POST /leave/users/:userId/balances/adjust (leave:manage_balances) */
  adjust = async (req, res, next) => {
    try {
      const data = await this.leaveBalanceService.adjustBalance({
        userId: req.params.userId,
        leaveTypeId: req.body.leaveTypeId,
        year: req.body.year,
        deltaDays: req.body.deltaDays,
        reason: req.body.reason,
        actor: this.actor(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** Coerces an optional query year to an integer (defaults to current year). */
  parseYear(value) {
    const year =
      value === undefined || value === null || value === ""
        ? new Date().getFullYear()
        : Number(value);
    if (!Number.isInteger(year) || year < 2000) {
      throw new ValidationError("A valid year is required.", { field: "year" });
    }
    return year;
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

module.exports = { LeaveBalanceController };
