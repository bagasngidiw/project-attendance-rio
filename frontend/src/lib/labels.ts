/**
 * Central Indonesian display labels for dynamic values (status enums, payload
 * keys, report columns) that arrive from the API as machine-readable strings.
 */

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draf",
  PENDING: "Menunggu",
  PENDING_APPROVAL: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};

export function requestStatusLabel(status: string | null | undefined): string {
  return REQUEST_STATUS_LABELS[status ?? ""] ?? status ?? "-";
}

/** Jenis permintaan dalam Bahasa Indonesia (FR-007 localize). */
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  LEAVE: "Cuti",
  OVERTIME: "Lembur",
  TRIP: "Perjalanan Dinas",
  PERMISSION: "Ijin",
  SAKIT: "Sakit",
};

export function requestTypeLabel(type: string | null | undefined): string {
  return REQUEST_TYPE_LABELS[type ?? ""] ?? type ?? "-";
}

/** Nama kejadian riwayat dalam Bahasa Indonesia. */
export const REQUEST_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: "Diajukan",
  ASSIGNED: "Ditugaskan",
  CLAIMED: "Diklaim",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
  EDITED: "Diedit",
  ESCALATED: "Dinaikkan",
};

export function requestEventLabel(event: string | null | undefined): string {
  return REQUEST_EVENT_LABELS[event ?? ""] ?? event ?? "-";
}

/** Kunci payload internal yang tidak boleh ditampilkan di tampilan detail. */
const INTERNAL_PAYLOAD_KEYS = new Set(["approvalTarget", "leaveTypeName", "sicknessTypeName"]);

export function isInternalPayloadKey(key: string): boolean {
  return INTERNAL_PAYLOAD_KEYS.has(key);
}

/** Merender nilai payload dengan aman — object tidak pernah jadi "[object Object]". */
export function payloadValueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.targetType) {
      return `Target ${String(v.targetType).toLowerCase()} · ${v.targetRoleId ? "peran" : v.targetUserId ? "pengguna" : ""}`.trim();
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Resolves leave/sickness type ids to readable names in payload grids.
 * Order: payload snapshot name (set at submission) → active registry map →
 * legacy label map (leave) / raw value (sickness, last resort).
 */
export function payloadDisplayValue(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
  leaveTypeNames: Record<string, string>,
  sicknessTypeNames: Record<string, string>
): string {
  const p = payload as Record<string, string>;
  if (key === "leaveType") {
    return p.leaveTypeName || leaveTypeNames[String(value)] || leaveTypeLabel(String(value));
  }
  if (key === "sicknessType") {
    return p.sicknessTypeName || sicknessTypeNames[String(value)] || String(value);
  }
  return payloadValueText(value);
}

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  CLOCKED_IN: "Absen masuk",
  CLOCKED_OUT: "Absen keluar",
  NOT_STARTED: "Belum mulai",
  // FR-001/FR-002: approved-leave attendance records.
  LEAVE: "Cuti",
};

export function attendanceStatusLabel(status: string | null | undefined): string {
  const normalized = (status ?? "").replaceAll(" ", "_").toUpperCase();
  return ATTENDANCE_STATUS_LABELS[normalized] ?? status ?? "—";
}

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Nonaktif",
  PENDING: "Menunggu",
};

export function userStatusLabel(status: string | null | undefined): string {
  return USER_STATUS_LABELS[status ?? ""] ?? status ?? "—";
}

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Tahunan",
  SICK: "Sakit",
  PERSONAL: "Pribadi",
};

export function leaveTypeLabel(type: string | null | undefined): string {
  return LEAVE_TYPE_LABELS[type ?? ""] ?? type ?? "—";
}

export const PAYLOAD_LABELS: Record<string, string> = {
  leaveType: "Jenis cuti",
  sicknessType: "Tipe sakit",
  startDate: "Tanggal mulai",
  endDate: "Tanggal selesai",
  reason: "Alasan",
  destination: "Tujuan",
  purpose: "Tujuan kegiatan",
  date: "Tanggal",
  startTime: "Waktu mulai",
  endTime: "Waktu selesai",
  durationHours: "Durasi (jam)",
};

export function payloadLabel(key: string): string {
  return PAYLOAD_LABELS[key] ?? key;
}

export const REPORT_COLUMN_LABELS: Record<string, string> = {
  employee: "Karyawan",
  date: "Tanggal",
  clockInAt: "Absen masuk",
  clockOutAt: "Absen keluar",
  status: "Status",
  exceptionTypes: "Pengecualian",
  leaveType: "Jenis cuti",
  sicknessType: "Tipe sakit",
  startDate: "Tanggal mulai",
  endDate: "Tanggal selesai",
  reason: "Alasan",
  startTime: "Waktu mulai",
  endTime: "Waktu selesai",
  durationHours: "Durasi (jam)",
  destination: "Tujuan",
  purpose: "Tujuan kegiatan",
  approvalTarget: "Target Persetujuan",
  assignedApprover: "Penyetuju Ditugaskan",
  approvedBy: "Disetujui Oleh",
  rejectedBy: "Ditolak Oleh",
  rejectionReason: "Alasan Penolakan",
};

export function reportColumnLabel(key: string): string {
  return REPORT_COLUMN_LABELS[key] ?? key;
}

export const ORG_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Nonaktif",
};

export function orgStatusLabel(status: string | null | undefined): string {
  return ORG_STATUS_LABELS[status ?? ""] ?? status ?? "—";
}

export const OUTCOME_LABELS: Record<string, string> = {
  SUCCESS: "Sukses",
  FAILURE: "Gagal",
  DENIED: "Ditolak",
};

export function outcomeLabel(outcome: string | null | undefined): string {
  return OUTCOME_LABELS[outcome ?? ""] ?? outcome ?? "—";
}
