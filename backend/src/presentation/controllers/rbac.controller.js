/**
 * RbacController — maps HTTP requests to RbacService (design §5.1).
 */

class RbacController {
  constructor({ rbacService }) {
    this.rbacService = rbacService;
  }

  listRoles = async (req, res, next) => {
    try {
      const data = await this.rbacService.listRoles();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  getRole = async (req, res, next) => {
    try {
      const data = await this.rbacService.getRole(req.params.id);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  listPermissions = async (req, res, next) => {
    try {
      const data = await this.rbacService.listPermissionsGrouped();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  getUserEffectivePermissions = async (req, res, next) => {
    try {
      const data = await this.rbacService.getUserEffectivePermissions(
        req.params.id
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  assignRoles = async (req, res, next) => {
    try {
      const data = await this.rbacService.assignRoles(req.params.id, req.body.roleIds, {
        actorId: req.auth.userId,
        actorUsername: req.auth.username,
        actorRoleKeys: req.auth.roles,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { RbacController };
