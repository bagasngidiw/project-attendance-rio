/**
 * CameraVerification — TODO.md FR-002. Live preview → capture → retake with
 * explicit state labels and recovery guidance. Consumes useAttendanceVerification.
 */

import { Button } from "@/components/ui/Button";

import type { CameraState } from "./useAttendanceVerification";

const MESSAGES: Record<CameraState, string> = {
  idle: "Klik “Aktifkan Kamera” untuk memulai verifikasi.",
  requesting: "Menunggu izin kamera…",
  active: "Kamera aktif. Ambil foto untuk verifikasi.",
  captured: "Foto siap. Ulangi jika kurang jelas.",
  denied: "Izin kamera ditolak. Buka pengaturan browser dan izinkan akses kamera, lalu coba lagi.",
  unavailable: "Kamera tidak terdeteksi atau sedang digunakan aplikasi lain. Periksa perangkat Anda.",
  in_use: "Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.",
  error: "Gagal mengakses kamera. Coba lagi atau hubungi HR.",
};

export function CameraVerification({
  camera,
  photo,
  attachVideo,
  onStart,
  onCapture,
  onRetake,
}: {
  camera: CameraState;
  photo: { dataUrl: string | null };
  attachVideo: (node: HTMLVideoElement | null) => void;
  onStart: () => void;
  onCapture: () => void;
  onRetake: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Kamera / Foto Keberadaan</p>
        <div className="flex gap-1.5">
          {camera === "requesting" ? (
            <Button size="sm" variant="secondary" disabled>
              Meminta izin…
            </Button>
          ) : camera === "active" ? (
            <Button size="sm" onClick={onCapture}>
              Ambil Foto
            </Button>
          ) : camera === "captured" ? (
            <Button size="sm" variant="secondary" onClick={onRetake}>
              Ulangi Foto
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onStart}>
              Aktifkan Kamera
            </Button>
          )}
        </div>
      </div>

      {/* 16:9 live preview; mirrored (selfie view) via scaleX(-1). The canvas
          capture still produces the real (unmirrored) image. */}
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-slate-100">
        {camera === "active" ? (
          <video
            ref={attachVideo}
            className="h-full w-full -scale-x-100 object-cover"
            playsInline
            muted
          />
        ) : photo.dataUrl ? (
          <img src={photo.dataUrl} alt="Foto keberadaan" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="px-3 text-center text-xs text-slate-400">{MESSAGES[camera]}</p>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">{MESSAGES[camera]}</p>
    </div>
  );
}
