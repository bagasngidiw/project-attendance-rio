/**
 * Mongoose schema + model for the `users` collection (design §7.1).
 */

const mongoose = require("mongoose");

const USER_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING: "PENDING",
});

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
      index: true,
    },
    passwordHash: { type: String, required: true },
    passwordVersion: { type: Number, default: 0 },
    // Password-policy bookkeeping (FR-044): when the password last changed and
    // a bounded history of recent hashes (reuse prevention). Both are additive
    // and never exposed through the API.
    passwordChangedAt: { type: Date, default: null },
    passwordHistory: { type: [String], default: [] },
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    positionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Position",
      default: null,
      index: true,
    },
    // Denormalized mirror of the user_roles join (design §7.5): the user
    // document carries its role relations as Role ObjectIds so collections are
    // self-describing. `user_roles` remains the source of truth; every role
    // change keeps this field in sync via UserRoleRepository.replaceRolesForUser.
    roleIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Role",
      default: [],
      index: true,
    },
    // Reporting line (FR-006): a user's direct manager, defining the Manager's
    // team scope. Nullable for employees outside any reporting structure.
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    lastLoginAt: { type: Date, default: null },
    // Self-service fields (FR-021): editable by the employee on their own
    // profile. HR-managed fields stay separate.
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    emergencyContact: { type: String, default: "" },
    personalEmail: { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    notificationPreferences: { type: mongoose.Schema.Types.Mixed, default: {} },
    // TODO.md §8/§9/§10: per-employee work schedule (Absensi consumes this).
    workingDays: { type: [Number], default: [] }, // 0=Sun..6=Sat
    workingStartTime: { type: String, default: "" }, // HH:MM
    workingEndTime: { type: String, default: "" }, // HH:MM
    // TODO.md §7: per-leave-type quota (allocated/used; remaining = diff).
    leaveQuotas: {
      type: [
        {
          leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },
          allocatedDays: { type: Number, default: 0 },
          usedDays: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Text index for admin search (FR-029/FR-023): name + username + email.
userSchema.index({ name: "text", username: "text", email: "text" });

const UserModel = mongoose.model("User", userSchema);

module.exports = { UserModel, USER_STATUS };
