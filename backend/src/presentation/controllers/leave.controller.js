/**
 * LeaveController — leave submission surface (FR-036), guarded by `leave:submit`,
 * plus the balance read surface (TODO.md FR-004/FR-007) for `leave:view_balances`.
 */

class LeaveController {
  constructor({ leaveService, leaveBalanceService = null }) {
    this.leaveService = leaveService;
    this.leaveBalanceService = leaveBalanceService;
  }

  /** POST /leave/requests */
  submit = async (req, res, next) => {
    try {
      const data = await this.leaveService.submit({
        requesterId: req.auth.userId,
        input: req.body,
        actor: this.actor(req),
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /leave/balances — balances for a year; self by default, or a target
   *  employee when the caller holds `leave:view_all` / `leave:manage_balances`. */
  listBalances = async (req, res, next) => {
    try {
      if (!this.leaveBalanceService) {
        return res.status(200).json({ data: [] });
      }
      const year = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();
      const targetId = req.query.userId ? String(req.query.userId) : null;
      const isSelf = !targetId || String(targetId) === String(req.auth.userId);
      if (!isSelf) {
        const hasScope = (req.auth.permissions ?? []).some((p) =>
          ["leave:view_all", "leave:manage_balances"].includes(p)
        );
        if (!hasScope) {
          const { PermissionDeniedError } = require("../../domain/errors");
          throw new PermissionDeniedError("leave:view_all");
        }
      }
      const data = await this.leaveBalanceService.getBalancesForUser(
        isSelf ? req.auth.userId : targetId,
        year
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      actorPermissions: req.auth.permissions,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { LeaveController };
