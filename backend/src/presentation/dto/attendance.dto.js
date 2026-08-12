/**
 * Attendance DTOs (FR-035 / FR-020 / FR-041 / TODO.md FR-008..FR-012) —
 * correction body, query filters, and the verification payload for clock
 * in/out (location + camera evidence; the server timestamp is authoritative).
 */

const { z } = require("zod");

const correctDto = z.object({
  field: z.enum(["clockInAt", "clockOutAt"]),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  reason: z.string().min(1, "A correction reason is required.").max(512),
});

const attendanceQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(["NORMAL", "EXCEPTION"]).optional(),
  exception: z
    .enum([
      "MISSING_CLOCK_IN",
      "MISSING_CLOCK_OUT",
      "DUPLICATE",
      "CONFLICT",
      "ANOMALY",
    ])
    .optional(),
  departmentId: z.string().optional(),
  employeeId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** TODO.md FR-009/FR-012: geolocation evidence for a clock event. */
const locationDto = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional().nullable(),
    timestamp: z.string().datetime().optional().nullable(),
    permissionState: z.string().max(64).optional().default(""),
    acquisitionStatus: z.string().max(64).optional().default(""),
  })
  .nullable()
  .optional();

/** TODO.md FR-008/FR-012: camera/selfie verification summary. */
const clockEventDto = z.preprocess(
  (value) => (value === undefined ? {} : value),
  z.object({
    location: locationDto,
    camera: z
      .object({
        status: z.string().max(64).optional().default(""),
        capturedAt: z.string().datetime().optional().nullable(),
        mediaRef: z.string().max(512).optional().nullable(),
      })
      .optional()
      .nullable(),
    // TODO.md FR-006: optional operational device metadata (no fingerprinting).
    device: z
      .object({
        category: z.string().max(32).optional().default(""),
        browser: z.string().max(64).optional().default(""),
        os: z.string().max(64).optional().default(""),
        cameraAvailable: z.boolean().optional().nullable(),
        locationAvailable: z.boolean().optional().nullable(),
      })
      .optional()
      .nullable(),
  })
);

module.exports = { correctDto, attendanceQuerySchema, clockEventDto };
