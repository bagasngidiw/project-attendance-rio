/**
 * Attachment routes (FR-017) — request-scoped file upload/download/delete.
 * Uploads use in-memory multer storage capped at 10 MB; the controller
 * rejects requests that carry no file. Every route is guarded by its module
 * permission at the boundary; request-scoped access is enforced in the
 * service.
 */

const { Router } = require("express");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createAttachmentRoutes({ attachmentController, authenticate, authorize }) {
  const router = Router();

  router.post(
    "/requests/:requestId/attachments",
    authenticate,
    authorize("files:upload"),
    upload.single("file"),
    attachmentController.upload
  );

  router.get(
    "/requests/:requestId/attachments",
    authenticate,
    authorize("files:download"),
    attachmentController.list
  );

  router.get(
    "/attachments/:id/download",
    authenticate,
    authorize("files:download"),
    attachmentController.download
  );

  router.delete(
    "/attachments/:id",
    authenticate,
    authorize("files:delete"),
    attachmentController.delete
  );

  return router;
}

module.exports = { createAttachmentRoutes };
