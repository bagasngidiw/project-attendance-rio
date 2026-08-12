/**
 * Notification routes (FR-014 / FR-015) — all authenticated and owner-scoped.
 */

const { Router } = require("express");
const { updatePreferencesDto } = require("../dto/notification.dto");
const { validate } = require("./auth.routes");

function createNotificationRoutes({ notificationController, authenticate }) {
  const router = Router();

  router.use(authenticate);

  router.get("/", notificationController.list);
  router.get("/unread-count", notificationController.unreadCount);
  router.post("/read-all", notificationController.markAllRead);
  router.get("/preferences", notificationController.getPreferences);
  router.put(
    "/preferences",
    validate(updatePreferencesDto),
    notificationController.updatePreferences
  );
  router.post("/:id/read", notificationController.markRead);

  return router;
}

module.exports = { createNotificationRoutes };
