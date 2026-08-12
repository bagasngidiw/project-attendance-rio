/**
 * Attachment domain (FR-017) — upload validation + stored-name sanitization.
 *
 * Uploads are governed by the platform `fileUpload` setting (allowed MIME
 * types + max size bytes). Untrusted client names are sanitized into a
 * UUID-prefixed, filesystem-safe storage key so nothing user-supplied reaches
 * the storage layer verbatim.
 */

const path = require("path");
const crypto = require("crypto");
const { ValidationError } = require("./errors");

const MAX_ORIGINAL_NAME_LENGTH = 255;

/**
 * Validates an upload against the platform policy.
 *
 * @param {{ mimeType?: string, sizeBytes?: number, originalName?: string }} input
 * @param {{ allowedTypes?: string[], maxSizeBytes?: number }} policy
 * @throws {ValidationError}
 */
function validateUpload({ mimeType, sizeBytes, originalName }, { allowedTypes = [], maxSizeBytes }) {
  if (typeof originalName !== "string" || originalName.trim() === "") {
    throw new ValidationError("A file name is required.", { field: "originalName" });
  }
  if (originalName.length > MAX_ORIGINAL_NAME_LENGTH) {
    throw new ValidationError("File name is too long.", { field: "originalName" });
  }
  if (/[/\\]/.test(originalName) || originalName.includes("..")) {
    throw new ValidationError(
      "File name must not contain path separators or traversal sequences.",
      { field: "originalName" }
    );
  }
  if (!allowedTypes.includes(mimeType)) {
    throw new ValidationError("File type is not allowed.", { field: "mimeType" });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new ValidationError("File size must be a positive number of bytes.", {
      field: "sizeBytes",
    });
  }
  if (sizeBytes > maxSizeBytes) {
    throw new ValidationError(`File exceeds the maximum size of ${maxSizeBytes} bytes.`, {
      field: "sizeBytes",
    });
  }
}

/**
 * Builds a filesystem-safe storage key: `<uuid>-<basename>` with every
 * character outside [a-zA-Z0-9._-] stripped. Falls back to `file` when the
 * cleaned basename is empty so the key is never blank.
 *
 * @param {string} originalName
 * @returns {string}
 */
function sanitizeStoredName(originalName) {
  const base = path.basename(String(originalName ?? ""));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "");
  return `${crypto.randomUUID()}-${cleaned || "file"}`;
}

module.exports = {
  validateUpload,
  sanitizeStoredName,
  MAX_ORIGINAL_NAME_LENGTH,
};
