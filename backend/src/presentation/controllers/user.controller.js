/**
 * UserController — user lifecycle (FR-029) + current-user + self password
 * change (FR-028). Admin endpoints are permission-guarded at the route layer;
 * every handler passes actor context so mutations are audited.
 */

class UserController {
  constructor({ userRepository, rbacService, userAdminService, passwordService }) {
    this.userRepository = userRepository;
    this.rbacService = rbacService;
    this.userAdminService = userAdminService;
    this.passwordService = passwordService;
  }

  /** GET /users/me — current user identity + roles + permissions. */
  me = async (req, res, next) => {
    try {
      const user = await this.userRepository.assertExists(req.auth.userId);
      const { permissions } = await this.rbacService.getUserEffectivePermissions(
        req.auth.userId
      );
      const data = {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        roles: req.auth.roles,
        permissions,
      };
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /users — paginated, searchable list (FR-029/FR-023). */
  list = async (req, res, next) => {
    try {
      const { search, status, roleId, departmentId, page, pageSize } = req.query;
      const data = await this.userAdminService.listUsers({
        search,
        status,
        roleId,
        departmentId,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /users/:id — single user with roles. */
  get = async (req, res, next) => {
    try {
      const data = await this.userAdminService.getUser(req.params.id);
      res.status(200).json({ data });    } catch (err) {
      next(err);
    }
  };

  /** POST /users — create user with temporary credential + roles. */
  create = async (req, res, next) => {
    try {
      const data = await this.userAdminService.createUser(req.body, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /users/:id — edit identity/org fields. */
  update = async (req, res, next) => {
    try {
      const data = await this.userAdminService.updateUser(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /users/:id/deactivate — reversible deactivation (SUPER_ADMIN guard). */
  deactivate = async (req, res, next) => {
    try {
      const data = await this.userAdminService.deactivateUser(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /users/:id/activate — re-enable sign-in. */
  activate = async (req, res, next) => {
    try {
      const data = await this.userAdminService.activateUser(req.params.id, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /users/:id/reset-password — temporary credential + must-change gate. */
  resetPassword = async (req, res, next) => {
    try {
      const data = await this.userAdminService.resetPassword(
        req.params.id,
        { initialPassword: req.body.initialPassword },
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /auth/change-password — self-service credential change (FR-028/044). */
  changePassword = async (req, res, next) => {
    try {
      const data = await this.passwordService.changePassword(
        req.auth.userId,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /users/:id/work-schedule — employee working days + hours (TODO.md §8/9). */
  updateWorkSchedule = async (req, res, next) => {
    try {
      const data = await this.userAdminService.updateWorkSchedule(
        req.params.id,
        req.body,
        this.actor(req)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /users/:id/leave-quota — per-leave-type allocation (TODO.md §7). */
  upsertLeaveQuota = async (req, res, next) => {
    try {
      const data = await this.userAdminService.upsertLeaveQuota(
        req.params.id,
        req.body,
        this.actor(req)
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

module.exports = { UserController };
