/**
 * Mongoose schema + model for the `departments` collection (FR-024).
 * Flat department list; deactivation preserves historical references.
 */

const mongoose = require("mongoose");

const ORG_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, default: "", trim: true, uppercase: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ORG_STATUSES, default: "ACTIVE", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const DepartmentModel = mongoose.model("Department", departmentSchema);

module.exports = { DepartmentModel, ORG_STATUSES };
