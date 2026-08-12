/**
 * Mongoose schema + model for the `attachments` collection (FR-017).
 *
 * Records are soft-deleted via `deletedAt` (null until removed) so the audit
 * trail survives a file's removal; the underlying object is purged from the
 * storage layer while the metadata row stays.
 */

const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      required: true,
      index: true,
    },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attachmentSchema.index({ requestId: 1, deletedAt: 1 });

const AttachmentModel = mongoose.model("Attachment", attachmentSchema);

module.exports = { AttachmentModel };
