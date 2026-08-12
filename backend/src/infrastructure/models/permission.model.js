/**
 * Mongoose schema + model for the `permissions` collection (design §7.3).
 * This is the persisted registry; the authoritative list of keys lives in
 * the domain layer and the registry is (re)seeded idempotently at boot.
 */

const mongoose = require("mongoose");

const PERMISSION_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

const permissionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    module: { type: String, required: true, trim: true, uppercase: true, index: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(PERMISSION_STATUS),
      default: PERMISSION_STATUS.ACTIVE,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PermissionModel = mongoose.model("Permission", permissionSchema);

module.exports = { PermissionModel, PERMISSION_STATUS };
