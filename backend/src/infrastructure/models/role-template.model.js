/**
 * Mongoose schema + model for the `role_templates` collection (FR-064 V.7).
 *
 * The static catalog in `domain/role-templates.js` is the source of truth for
 * v1; this model exists so templates can later be administered at runtime.
 * Templates never inject hidden permissions — they are purely a starting point.
 */

const mongoose = require("mongoose");

const roleTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    baseLevel: { type: Number, default: 10 },
    baseScope: {
      type: String,
      enum: [
        "SELF",
        "DIRECT_SUBORDINATES",
        "DIRECT_AND_INDIRECT_SUBORDINATES",
        "DEPARTMENT",
        "ALL_EMPLOYEES",
      ],
      default: "SELF",
    },
    basePermissions: [{ type: String }],
    isSystem: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const RoleTemplateModel = mongoose.model("RoleTemplate", roleTemplateSchema);

module.exports = { RoleTemplateModel };
