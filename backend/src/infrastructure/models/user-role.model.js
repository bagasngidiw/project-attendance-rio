/**
 * Mongoose schema + model for the `user_roles` join collection
 * (design §7.5). Represents the N—M relationship between User and Role.
 */

const mongoose = require("mongoose");

const userRoleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  }
);

userRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });

const UserRoleModel = mongoose.model("UserRole", userRoleSchema);

module.exports = { UserRoleModel };
