/**
 * Mongoose schema + model for the `roles` collection (design §7.2).
 */

const mongoose = require("mongoose");

const ROLE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

/**
 * FR-064 data scopes. These are the explicit scope the role may access;
 * actual access still requires the matching permission — the scope alone
 * never grants data access.
 */
const ROLE_DATA_SCOPES = Object.freeze([
  "SELF",
  "DIRECT_SUBORDINATES",
  "DIRECT_AND_INDIRECT_SUBORDINATES",
  "DEPARTMENT",
  "ALL_EMPLOYEES",
]);

const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isSystem: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(ROLE_STATUS),
      default: ROLE_STATUS.ACTIVE,
      index: true,
    },
    // FR-064: role level (higher numeric = higher authority) + optional label.
    level: { type: Number, default: 10 },
    levelLabel: { type: String, default: "" },
    // FR-064: explicit data scope on the role.
    dataScope: {
      type: String,
      enum: ROLE_DATA_SCOPES,
      default: "SELF",
    },
    // Optimistic lock (FR-011): incremented on every mutation. Clients submit
    // the version they loaded; a mismatch rejects the write with 409.
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const RoleModel = mongoose.model("Role", roleSchema);

module.exports = { RoleModel, ROLE_STATUS, ROLE_DATA_SCOPES };
