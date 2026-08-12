/**
 * RbacAdminController — maps HTTP requests to RoleAdminService (FR-011 §5.1).
 */

class RbacAdminController {
  constructor({ roleAdminService }) {
    this.roleAdminService = roleAdminService;
  }

  getMatrix = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.getMatrix();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  createRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.createRole(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  getRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.getRole(req.params.id);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  updateRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.updateRole(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  setPermissions = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.setRolePermissions(
        req.params.id,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  disableRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.disableRole(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  enableRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.enableRole(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  getEffectivePermissions = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.getUserEffectivePermissionsDetailed(
        req.params.id
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  // FR-064: console metadata (checklist groups, templates, dependencies).
  getMeta = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.getMeta();
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  // FR-064: validate a prospective role without persisting.
  validateRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.validateRole(req.body);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  // FR-064: effective-access preview for a role.
  previewRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.previewRole(req.params.id);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  // FR-064: copy an existing role into a draft.
  copyRole = async (req, res, next) => {
    try {
      const data = await this.roleAdminService.copyRole(req.params.sourceId);
      res.status(200).json({ data });
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

module.exports = { RbacAdminController };
