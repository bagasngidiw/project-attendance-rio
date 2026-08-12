/**
 * Bulk import DTO (FR-061) — JSON-encoded payload; no multipart uploads.
 * Content is a raw CSV/JSON string validated for shape only at the boundary.
 */

const { z } = require("zod");

const importUsersDto = z.object({
  format: z.enum(["csv", "json"], "format must be \"csv\" or \"json\"."),
  content: z.string().min(1, "content is required.").max(500000),
});

module.exports = { importUsersDto };
