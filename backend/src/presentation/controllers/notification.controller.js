/**
 * NotificationController — the notification inbox + preferences (FR-014/015).
 * All endpoints are owner-scoped to the signed-in user.
 */

class NotificationController {
  constructor({ notificationService }) {
    this.notificationService = notificationService;
  }

  /** GET /notifications — the caller's inbox (unread first). */
  list = async (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      const data = await this.notificationService.list(req.auth.userId, { page, pageSize });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /notifications/unread-count — unread count for the bell. */
  unreadCount = async (req, res, next) => {
    try {
      const data = { unread: await this.notificationService.unreadCount(req.auth.userId) };
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /notifications/:id/read — mark one owned notification read. */
  markRead = async (req, res, next) => {
    try {
      const data = await this.notificationService.markRead(req.params.id, req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /notifications/read-all — mark all owned notifications read. */
  markAllRead = async (req, res, next) => {
    try {
      const data = await this.notificationService.markAllRead(req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /notifications/preferences — current preferences. */
  getPreferences = async (req, res, next) => {
    try {
      const data = await this.notificationService.getPreferences(req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /notifications/preferences — update opt-out list. */
  updatePreferences = async (req, res, next) => {
    try {
      const data = await this.notificationService.updatePreferences(
        req.auth.userId,
        req.body,
        { actorId: req.auth.userId, actorRoleKeys: req.auth.roles }
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { NotificationController };
