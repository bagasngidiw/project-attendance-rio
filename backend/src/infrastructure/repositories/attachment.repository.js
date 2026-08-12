/**
 * AttachmentRepository — persistence for request attachments (FR-017).
 * Soft-deleted records are hidden by default; callers opt in to see them.
 */

const { AttachmentModel } = require("../models/attachment.model");

class AttachmentRepository {
  /**
   * Creates an attachment metadata row.
   *
   * @param {{ key: string, requestId: string, originalName: string, mimeType: string, sizeBytes: number, uploadedBy: string }} input
   */
  async create({ key, requestId, originalName, mimeType, sizeBytes, uploadedBy }) {
    return AttachmentModel.create({
      key,
      requestId,
      originalName,
      mimeType,
      sizeBytes,
      uploadedBy,
      deletedAt: null,
    });
  }

  /**
   * Finds a single attachment by id.
   *
   * @param {string} id
   * @param {{ includeDeleted?: boolean }} options
   */
  async findById(id, { includeDeleted = false } = {}) {
    const filter = { _id: id };
    if (!includeDeleted) filter.deletedAt = null;
    return AttachmentModel.findOne(filter);
  }

  /**
   * Lists attachments for a request, oldest first.
   *
   * @param {string} requestId
   * @param {{ includeDeleted?: boolean }} options
   */
  async findByRequest(requestId, { includeDeleted = false } = {}) {
    const filter = { requestId };
    if (!includeDeleted) filter.deletedAt = null;
    return AttachmentModel.find(filter).sort({ createdAt: 1, _id: 1 }).lean();
  }

  /**
   * Soft-deletes an attachment (returns null when already deleted or missing).
   *
   * @param {string} id
   * @param {{ deletedBy?: string|null }} options
   */
  async softDelete(id, { deletedBy = null } = {}) {
    return AttachmentModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy } },
      { returnDocument: "after" }
    );
  }
}

module.exports = { AttachmentRepository };
