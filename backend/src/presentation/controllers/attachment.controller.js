/**
 * AttachmentController (FR-017) — request-scoped file upload/download surface.
 * Route-level authorization is enforced by `files:upload` / `files:download` /
 * `files:delete`; request-scoped access lives in the service.
 */

const { attachmentListQuerySchema } = require("../dto/attachment.dto");
const { ValidationError } = require("../../domain/errors");

class AttachmentController {
  constructor({ attachmentService }) {
    this.attachmentService = attachmentService;
  }

  /** POST /requests/:requestId/attachments */
  upload = async (req, res, next) => {
    try {
      if (!req.file) {
        next(new ValidationError("A file is required.", { field: "file" }));
        return;
      }
      const data = await this.attachmentService.upload({
        requestId: req.params.requestId,
        file: req.file,
        actor: this.actor(req),
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /requests/:requestId/attachments */
  list = async (req, res, next) => {
    try {
      const parsed = attachmentListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(
          new ValidationError("Invalid query filters.", {
            issues: parsed.error.issues,
          })
        );
        return;
      }
      const items = await this.attachmentService.list({
        requestId: req.params.requestId,
        actor: this.actor(req),
      });
      res.status(200).json({ data: { items } });
    } catch (err) {
      next(err);
    }
  };

  /** GET /attachments/:id/download */
  download = async (req, res, next) => {
    try {
      const { buffer, attachment } = await this.attachmentService.download({
        attachmentId: req.params.id,
        actor: this.actor(req),
      });
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${attachment.originalName.replace(/["\\]/g, "")}"`
      );
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  /** DELETE /attachments/:id */
  delete = async (req, res, next) => {
    try {
      const data = await this.attachmentService.delete({
        attachmentId: req.params.id,
        actor: this.actor(req),
      });
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

module.exports = { AttachmentController };
