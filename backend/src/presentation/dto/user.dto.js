/**
 * User lifecycle DTOs (FR-029 / FR-028) — Zod validation at the HTTP boundary.
 * Password fields are validated for shape here; policy compliance (length,
 * complexity, reuse) is enforced by the PasswordService.
 */

const { z } = require("zod");

const createUserDto = z.object({
  username: z.string().trim().min(2, "Username must be at least 2 characters.").max(64),
  email: z.string().trim().toLowerCase().email("A valid email is required."),
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(128),
  departmentId: z.string().min(1).optional().nullable(),
  positionId: z.string().min(1).optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
  roleIds: z.array(z.string().min(1)).min(1, "At least one role is required."),
  initialPassword: z.string().min(8).max(128),
  // TODO.md FR-001: allocated leave quota (hari) for balance-based types.
  jatahCuti: z.number().int().min(0).max(365).optional(),
});

const updateUserDto = z.object({
  name: z.string().trim().min(2).max(128).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  departmentId: z.string().min(1).optional().nullable(),
  positionId: z.string().min(1).optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
  // TODO.md FR-002: quota change requires a mandatory reason.
  jatahCuti: z.number().int().min(0).max(365).optional(),
  reason: z.string().trim().min(1).max(512).optional(),
});

const resetPasswordDto = z.object({
  initialPassword: z.string().min(8).max(128),
});

const changePasswordDto = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(128),
  newPassword: z.string().min(8).max(128),
});

/** TODO.md §8/§9: employee work schedule. */
const workScheduleDto = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, "Pilih minimal satu hari kerja."),
  workingStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Jam masuk harus HH:MM."),
  workingEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Jam pulang harus HH:MM."),
});

/** TODO.md §7: per-leave-type quota allocation. */
const leaveQuotaDto = z.object({
  leaveTypeId: z.string().min(1),
  allocatedDays: z.number().int().min(0).max(365),
});

module.exports = {
  createUserDto,
  updateUserDto,
  resetPasswordDto,
  changePasswordDto,
  workScheduleDto,
  leaveQuotaDto,
};
