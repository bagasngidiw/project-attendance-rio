/**
 * Attachment DTOs (FR-017) — query-parameter validation for the attachment
 * list surface. Upload bodies are handled by multer (multipart form data).
 */

const { z } = require("zod");

const attachmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

module.exports = { attachmentListQuerySchema };
