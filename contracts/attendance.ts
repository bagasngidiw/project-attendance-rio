/**
 * Attendance DTO types (FR-035 / FR-020 / FR-041).
 */

import type { ApiEnvelope } from "./auth";

export type AttendanceStatus = "NORMAL" | "EXCEPTION" | "LEAVE";
export type AttendanceSource = "SELF" | "CORRECTION";
export type AttendancePunctuality = "ON_TIME" | "LATE" | null;
export type AttendanceException =
  | "MISSING_CLOCK_IN"
  | "MISSING_CLOCK_OUT"
  | "DUPLICATE"
  | "CONFLICT"
  | "ANOMALY";

export interface AttendanceCorrectionDto {
  id: string;
  attendanceId: string;
  field: "clockInAt" | "clockOutAt";
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedBy: string | null;
  correctedAt: string;
}

export interface AttendanceLocationDto {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: string | null;
  permissionState: string;
  acquisitionStatus: string;
}

export interface AttendanceVerificationDto {
  camera: { status: string; capturedAt: string | null; mediaRef: string | null };
  location: { status: string; acquiredAt: string | null };
}

export interface AttendanceRecordDto {
  id: string;
  userId: string;
  date: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  status: AttendanceStatus;
  punctuality: AttendancePunctuality;
  exceptionTypes: AttendanceException[];
  source: AttendanceSource;
  version: number;
  clockInLocation?: AttendanceLocationDto | null;
  clockOutLocation?: AttendanceLocationDto | null;
  verification?: AttendanceVerificationDto | null;
  scheduleSnapshot?: {
    workingDays: number[];
    workingStartTime: string;
    workingEndTime: string;
    evaluatedAt: string | null;
  } | null;
  user?: { id: string; username: string; name: string } | null;
  corrections?: AttendanceCorrectionDto[];
}

export interface AttendanceListResult {
  items: AttendanceRecordDto[];
  page: number;
  pageSize: number;
  total: number;
}

export type AttendanceRecordResponse = ApiEnvelope<AttendanceRecordDto>;
export type AttendanceListResponse = ApiEnvelope<AttendanceListResult>;
