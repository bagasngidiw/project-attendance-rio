/**
 * DelegationController (FR-009) — delegation list/create/revoke surface.
 * Guarded by auth; create/revoke additionally require `delegation:manage`.
 */

class DelegationController {
  constructor({ delegationService }) {
    this.delegationService = delegationService;
  }

  /** GET /delegations */
  list = async (req, res, next) => {
    try {
      const data = await this.delegationService.listMyDelegations(req.auth.userId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /delegations */
  create = async (req, res, next) => {
    try {
      const data = await this.delegationService.createDelegation({
        delegatorId: req.auth.userId,
        input: req.body,
        actor: this.actor(req),
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /delegations/:id/revoke */
  revoke = async (req, res, next) => {
    try {
      const data = await this.delegationService.revokeDelegation({
        id: req.params.id,
        delegatorId: req.auth.userId,
        actor: this.actor(req),
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  };

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

module.exports = { DelegationController };
