/**
 * NavigationController — exposes the user's filtered navigation tree and bulk
 * permission checks (FR-003 / design §5.1).
 */

const {
  buildNavigationFor,
  checkPermissions,
} = require("../../application/navigation.service");

class NavigationController {
  constructor({ rbacService }) {
    this.rbacService = rbacService;
  }

  /**
   * GET /navigation — returns the navigation tree filtered by the current
   * user's effective permissions. Reads fresh permissions from the DB (not
   * the JWT claims) so role changes propagate even before token refresh.
   */
  navigation = async (req, res, next) => {
    try {
      const { permissions } =
        await this.rbacService.getUserEffectivePermissions(req.auth.userId);
      const data = buildNavigationFor(permissions);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /access/check — bulk permission evaluation for UI state
   * (design §5.1). Body: `{ keys: string[] }`.
   */
  checkAccess = async (req, res, next) => {
    try {
      const { permissions } =
        await this.rbacService.getUserEffectivePermissions(req.auth.userId);
      const data = checkPermissions(permissions, req.body.keys ?? []);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { NavigationController };
