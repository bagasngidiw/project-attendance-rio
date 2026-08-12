/**
 * AttendanceDetailDialog — full view of one attendance record: date,
 * clock-in/out, punctuality, exceptions, the captured selfie (fetched with the
 * auth token as a blob), and the geolocation data that was recorded.
 */

import { useEffect, useState } from "react";

import type { AttendanceRecordDto } from "@contracts/attendance";

import { attendanceApi } from "@/lib/axios";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { PunctualityBadge } from "./PunctualityBadge";
import { ExceptionChips } from "./ExceptionBadge";

function extractToken(mediaRef: string | null | undefined): string | null {
  if (!mediaRef) return null;
  const parts = mediaRef.split("/");
  return parts[parts.length - 1] || null;
}

function LocationRows({ location }: { location: AttendanceRecordDto["clockInLocation"] }) {
  if (!location || location.latitude === null || location.longitude === null) {
    return (
      <p className="text-sm text-slate-400">Tidak ada data lokasi.</p>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs text-slate-600 sm:grid-cols-2">
      <dt className="text-slate-400">Latitude</dt>
      <dd className="text-right font-mono">{location.latitude.toFixed(6)}</dd>
      <dt className="text-slate-400">Longitude</dt>
      <dd className="text-right font-mono">{location.longitude.toFixed(6)}</dd>
      <dt className="text-slate-400">Akurasi</dt>
      <dd className="text-right font-medium">±{location.accuracy ?? "—"} meter</dd>
      <dt className="text-slate-400">Waktu perolehan</dt>
      <dd className="text-right">
        {location.timestamp ? new Date(location.timestamp).toLocaleString() : "—"}
      </dd>
      <dt className="text-slate-400">Status</dt>
      <dd className="text-right">{location.acquisitionStatus || location.permissionState || "—"}</dd>
    </dl>
  );
}

export function AttendanceDetailDialog({
  record,
  onClose,
}: {
  record: AttendanceRecordDto;
  onClose: () => void;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    const token = extractToken(record.verification?.camera?.mediaRef);
    if (!token) return;
    let alive = true;
    // The effect starts an async media fetch; the loading flags must be set
    // before the fetch resolves (data-sync pattern, not a render cascade).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhotoLoading(true);
    setPhotoError(false);
    attendanceApi
      .getMedia(token)
      .then((blob) => {
        if (alive) setPhotoUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (alive) setPhotoError(true);
      })
      .finally(() => {
        if (alive) setPhotoLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [record.verification?.camera?.mediaRef]);

  const schedule = record.scheduleSnapshot;

  return (
    <Modal title="Detail absensi" onClose={onClose}>
      <div className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          <dt className="text-slate-400">Tanggal</dt>
          <dd className="text-right font-medium">{record.date}</dd>
          <dt className="text-slate-400">Absen masuk</dt>
          <dd className="text-right font-medium">
            {record.clockInAt ? new Date(record.clockInAt).toLocaleTimeString() : "—"}
          </dd>
          <dt className="text-slate-400">Absen keluar</dt>
          <dd className="text-right font-medium">
            {record.clockOutAt ? new Date(record.clockOutAt).toLocaleTimeString() : "—"}
          </dd>
          <dt className="text-slate-400">Ketepatan</dt>
          <dd className="text-right">
            <PunctualityBadge punctuality={record.punctuality} />
          </dd>
          <dt className="text-slate-400">Pengecualian</dt>
          <dd className="text-right">
            <ExceptionChips types={record.exceptionTypes} />
          </dd>
        </dl>

        {schedule ? (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Jadwal kerja saat absen
            </p>
            <p className="text-xs text-slate-600">
              Hari: {schedule.workingDays.length > 0 ? schedule.workingDays.join(", ") : "Mon–Fri (default)"} ·{" "}
              {schedule.workingStartTime || "—"} – {schedule.workingEndTime || "—"}
            </p>
          </div>
        ) : null}

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Foto yang diambil
          </p>
          <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
            {photoLoading ? (
              <Spinner label="Memuat foto..." />
            ) : photoUrl ? (
              <img src={photoUrl} alt="Foto keberadaan" className="h-full w-full object-cover" />
            ) : (
              <p className="px-3 text-center text-xs text-slate-400">
                {photoError
                  ? "Foto tidak dapat dimuat (mungkin sudah dihapus)."
                  : "Tidak ada foto pada catatan ini."}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lokasi absen masuk
          </p>
          <LocationRows location={record.clockInLocation} />
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lokasi absen keluar
          </p>
          <LocationRows location={record.clockOutLocation} />
        </div>
      </div>
    </Modal>
  );
}
