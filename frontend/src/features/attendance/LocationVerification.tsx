/**
 * LocationVerification — TODO.md FR-003. Acquires high-accuracy location and
 * shows it on an interactive Leaflet map (OSM tiles) with a "Lokasi Anda"
 * pinpoint + an accuracy circle — Google-Maps-like UX. The actual reported
 * accuracy is always displayed — never faked.
 *
 * Mapping choice (documented): Leaflet is the smallest viable interactive map
 * (~42 KB) — no heavy mapping SDK required.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { Button } from "@/components/ui/Button";

import type { GeoLocation, LocationState } from "./useAttendanceVerification";

const MESSAGES: Record<LocationState, string> = {
  idle: "Klik “Dapatkan Lokasi” untuk verifikasi.",
  requesting: "Memperoleh lokasi…",
  found: "Lokasi ditemukan.",
  low_accuracy: "Lokasi dengan akurasi rendah. Tetap dapat digunakan, pastikan sinyal GPS memadai.",
  denied: "Izin lokasi ditolak. Izinkan akses lokasi di pengaturan browser.",
  unavailable: "Lokasi perangkat tidak tersedia. Aktifkan GPS/lokasi perangkat.",
  timeout: "Waktu permintaan lokasi habis. Coba lagi.",
  error: "Gagal memperoleh lokasi. Coba lagi.",
};

function InteractiveMap({ location }: { location: GeoLocation }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([location.latitude, location.longitude], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update the pin + accuracy circle when the location changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { latitude, longitude, accuracy } = location;
    map.setView([latitude, longitude], 16);
    markerRef.current?.remove();
    circleRef.current?.remove();
    // Custom CSS pin (avoids the Vite/Leaflet default-icon 404 issue).
    const pin = L.divIcon({
      className: "",
      html: `<div style="position:relative;width:28px;height:28px;background:#e11d48;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4)"><div style="position:absolute;inset:6px;background:#fff;border-radius:50%"></div></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    markerRef.current = L.marker([latitude, longitude], { icon: pin, title: "Lokasi Anda" })
      .addTo(map)
      .bindPopup("Lokasi Anda");
    circleRef.current = L.circle([latitude, longitude], {
      radius: Math.max(accuracy, 1),
      color: "#6366f1",
      fillColor: "#6366f1",
      fillOpacity: 0.15,
      weight: 1,
    }).addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.latitude, location.longitude, location.accuracy]);

  return <div ref={containerRef} className="z-0 h-full w-full" aria-label="Peta lokasi Anda" />;
}

export function LocationVerification({
  locationState,
  location,
  onRequest,
}: {
  locationState: LocationState;
  location: GeoLocation | null;
  onRequest: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Lokasi Anda Sekarang</p>
        <Button size="sm" variant="secondary" onClick={onRequest}>
          {locationState === "requesting" ? "Mencari…" : location ? "Perbarui Lokasi" : "Dapatkan Lokasi"}
        </Button>
      </div>

      <div className="aspect-video w-full overflow-hidden rounded-lg bg-slate-100">
        {location ? (
          <InteractiveMap location={location} />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-slate-400">
            {MESSAGES[locationState]}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {location
          ? locationState === "low_accuracy"
            ? `Lokasi dengan akurasi rendah ±${location.accuracy} meter.`
            : `Lokasi ditemukan dengan akurasi ±${location.accuracy} meter.`
          : MESSAGES[locationState]}
      </p>
    </div>
  );
}
