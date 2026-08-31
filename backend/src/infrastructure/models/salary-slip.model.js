/**
 * Mongoose schema + model for the `salary_slips` collection (FR-006).
 *
 * A salary invoice slip is uploaded by a SUPERADMIN to a specific ACTIVE
 * user. The file itself lives on local disk (`salary-assets/`); this document
 * stores metadata only. `storageKey` is a random opaque token that is NEVER
 * exposed through any API response — downloads resolve it server-side.
 */

const mongoose = require("mongoose");

const salarySlipSchema = new mongoose.Schema(
  {
    // Recipient (penerima) of the slip.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Sender (pengirim) — always a SUPERADMIN-role user.
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Tanggal gajian (pay date).
    payDate: { type: Date, required: true },
    // Periode label, e.g. "Juli 2026".
    periodLabel: { type: String, required: true, trim: true, maxlength: 64 },
    notes: { type: String, default: "", maxlength: 512 },
    // Original file name (sanitized for display).
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    // Random token filename on disk — NEVER exposed in any DTO.
    storageKey: { type: String, required: true, unique: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

salarySlipSchema.index({ userId: 1, payDate: -1 });

const SalarySlipModel = mongoose.model("SalarySlip", salarySlipSchema);

module.exports = { SalarySlipModel };