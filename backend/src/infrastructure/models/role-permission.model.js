/**
 * Mongoose schema + model for the `role_permissions` join collection
 * (design §7.4). Represents the N—M relationship between Role and Permission.
 */

const mongoose = require("mongoose");

const rolePermissionSchema = new mongoose.Schema(
  {
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    permissionKey: {
      type: String,
      required: true,
      trim: true,
    },
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    grantedAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  }
);

rolePermissionSchema.index(
  { roleId: 1, permissionKey: 1 },
  { unique: true }
);

const RolePermissionModel = mongoose.model(
  "RolePermission",
  rolePermissionSchema
);

module.exports = { RolePermissionModel };
