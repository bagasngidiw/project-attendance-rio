/**
 * Mongoose schema + model for the `contract_types` collection.
 * Master data for employee contract types (NEW UPDATE TAD SIMBIKA).
 * Status only ACTIVE/INACTIVE — no PENDING/suggestion flow.
 */

const mongoose = require("mongoose");

const CONTRACT_TYPE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const contractTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: CONTRACT_TYPE_STATUSES,
      default: "ACTIVE",
      index: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const ContractTypeModel = mongoose.model("ContractType", contractTypeSchema);

module.exports = { ContractTypeModel, CONTRACT_TYPE_STATUSES };
