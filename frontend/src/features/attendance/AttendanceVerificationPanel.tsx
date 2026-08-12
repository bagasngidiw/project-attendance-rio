/**
 * AttendanceVerificationPanel — TODO.md FR-005/FR-006. Assembles the revamped
 * Absensi verification view: instructions → device info → camera → location →
 * readiness summary → gated submission (photo + location required). The selfie
 * is uploaded first and the returned mediaRef travels with the clock event;
 * the server records the authoritative timestamp.
 */

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PERMISSIONS } from "@contracts/permissions";

import { attendanceApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Can } from "@/features/auth/Can";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ExceptionChips } from "./ExceptionBadge";
import { useAttendanceVerification } from "./useAttendanceVerification";
import { CameraVerification } from "./CameraVerification";
import { LocationVerification } from "./LocationVerification";
import { DeviceInfoAccordion } from "./DeviceInfoAccordion";

export function AttendanceVerificationPanel({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["attendance-today"],
    queryFn: () => attendanceApi.today().then((r) => r.data.data),
  });

  const verification = useAttendanceVerification();
  const {
    camera,
    locationState,
    photo,
    location,
    device,
    readiness,
    attachVideo,
    startCamera,
    capture,
    retake,
    requestLocation,
  } = verification;

  const [submitting, setSubmitting] = useState(false);
  const mediaRef = useRef<string | null>(null);

  async function submitClock(kind: "in" | "out") {
    if (!readiness.complete) {
      toast.error("Lengkapi verifikasi kamera dan lokasi terlebih dahulu.");
      return;
    }
    if (!photo.dataUrl) {
      toast.error("Ambil foto terlebih dahulu.");
      return;
    }
    setSubmitting(true);
    try {
      // FR-008: upload the selfie once per attendance session, then reuse the
      // mediaRef for clock-in and clock-out.
      if (!mediaRef.current) {
        const blob = await (await fetch(photo.dataUrl)).blob();
        const file = new File([blob], "selfie.png", { type: "image/png" });
        const uploaded = await attendanceApi.uploadMedia(file);
        const ref = uploaded.data.data?.mediaRef;
        if (!ref) {
          toast.error("Gagal mengunggah foto verifikasi.");
          return;
        }
        mediaRef.current = ref;
      }
      const body = {
        location,
        camera: {
          status: "captured",
          capturedAt: photo.capturedAt,
          mediaRef: mediaRef.current,
        },
        device: device ?? undefined,
      };
      if (kind === "in") {
        await attendanceApi.clockIn(body);
        toast.success("Absen masuk tercatat.");
      } else {
        await attendanceApi.clockOut(body);
        toast.success("Absen keluar tercatat.");
      }
      refetch();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Tidak dapat mengirim absensi.");
    } finally {
      setSubmitting(false);
    }
  }

  const clockedIn = Boolean(data?.clockInAt && !data?.clockOutAt);
  const isOnLeave = data?.status === "LEAVE";

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-6">
      <h3 className="mb-1 font-semibold">Hari ini</h3>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Memuat status hari ini..." />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-600">Tidak dapat memuat status hari ini.</p>
      ) : isOnLeave ? (
        /* FR-002: approved leave — no verification flow, no clock actions. */
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <p className="font-medium text-emerald-800">Sedang Cuti</p>
          <p className="mt-1 text-sm text-emerald-700">
            Absensi tidak diperlukan pada tanggal ini. Status Anda tercatat
            sebagai cuti yang disetujui.
          </p>
          <p className="mt-3 text-xs text-emerald-600">{data?.date ?? "—"}</p>
        </div>
      ) : (
        <>
          {/* FR-008: hardcoded instructional guidance for the non-leave flow. */}
          <div className="mb-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">Verifikasi Absensi</p>
            <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs">
              <li>Akses kamera diperlukan untuk verifikasi absensi.</li>
              <li>Akses lokasi diperlukan untuk verifikasi absensi.</li>
              <li>Browser akan meminta izin.</li>
              <li>Karyawan harus mengizinkan kedua izin tersebut.</li>
              <li>Ikuti instruksi kamera/selfie.</li>
              <li>Absensi hanya dapat dikirim setelah data verifikasi siap.</li>
            </ol>
          </div>

          <dl className="mb-4 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Tanggal</dt>
              <dd className="font-medium">{data?.date ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Absen masuk</dt>
              <dd className="font-medium">
                {data?.clockInAt ? new Date(data.clockInAt).toLocaleTimeString() : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Absen keluar</dt>
              <dd className="font-medium">
                {data?.clockOutAt ? new Date(data.clockOutAt).toLocaleTimeString() : "—"}
              </dd>
            </div>
          </dl>

          {/* FR-004: device information accordion (separate container). */}
          <div className="mb-4">
            <DeviceInfoAccordion device={device} />
          </div>

          {/* FR-002 + FR-003: camera + location side by side (stacked mobile). */}
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <CameraVerification
              camera={camera}
              photo={photo}
              attachVideo={attachVideo}
              onStart={startCamera}
              onCapture={capture}
              onRetake={retake}
            />
            <LocationVerification
              locationState={locationState}
              location={location}
              onRequest={requestLocation}
            />
          </div>

          {/* FR-005: readiness summary. */}
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-xs font-medium">
            <span className={readiness.cameraReady ? "text-emerald-600" : "text-slate-400"}>
              Kamera: {readiness.cameraReady ? "✓ Siap" : "Belum siap"}
            </span>
            <span className={readiness.photoCaptured ? "text-emerald-600" : "text-slate-400"}>
              Foto: {readiness.photoCaptured ? "✓ Diambil" : "Belum diambil"}
            </span>
            <span className={readiness.locationReady ? "text-emerald-600" : "text-slate-400"}>
              Lokasi: {readiness.locationReady ? "✓ Terdeteksi" : "Belum terdeteksi"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <ExceptionChips types={data?.exceptionTypes ?? []} />
            <div className="flex gap-2">
              <Can permission={PERMISSIONS.ATTENDANCE_CLOCK_IN}>
                <Button
                  variant="primary"
                  disabled={Boolean(data?.clockInAt) || !readiness.complete || submitting}
                  loading={submitting}
                  onClick={() => submitClock("in")}
                >
                  Absen Masuk
                </Button>
              </Can>
              <Can permission={PERMISSIONS.ATTENDANCE_CLOCK_OUT}>
                <Button
                  variant="secondary"
                  disabled={!clockedIn || !readiness.complete || submitting}
                  loading={submitting}
                  onClick={() => submitClock("out")}
                >
                  Absen Keluar
                </Button>
              </Can>
            </div>
          </div>
          {!readiness.complete ? (
            <p className="mt-2 text-xs text-slate-400">
              Lengkapi verifikasi kamera dan lokasi terlebih dahulu.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
