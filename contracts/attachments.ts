/**
 * Attachment DTO types (FR-008 / FR-009 / FR-010) — request-scoped file
 * upload/list/download/delete surface. Internal storage keys never cross the
 * API boundary; only metadata is exposed.
 */

import type { ApiEnvelope } from "./auth";

/** Metadata DTO for a request attachment (internal `key` is never exposed). */
export interface AttachmentDto {
  id: string;
  requestId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

/** GET /requests/:requestId/attachments payload. */
export interface AttachmentListResult {
  items: AttachmentDto[];
}

export type AttachmentListResponse = ApiEnvelope<AttachmentListResult>;
export type AttachmentUploadResponse = ApiEnvelope<AttachmentDto>;
