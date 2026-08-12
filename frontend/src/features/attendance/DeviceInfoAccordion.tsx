/**
 * DeviceInfo — TODO.md FR-004. Expandable "Info Perangkat" accordion with
 * operational device metadata (category, browser, OS, capabilities, permission
 * states). No sensitive data, no fingerprinting.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import type { DeviceInfo as DeviceInfoData } from "./deviceInfo";

const PERMISSION_LABEL: Record<string, string> = {
  granted: "Diizinkan",
  denied: "Ditolak",
  prompt: "Menunggu izin",
  unknown: "Tidak diketahui",
};

export function DeviceInfoAccordion({ device }: { device: DeviceInfoData | null }) {
  const [open, setOpen] = useState(false);
  if (!device) return null;

  const summary = `Absensi via ${
    device.category === "mobile" ? "HP" : device.category === "tablet" ? "Tablet" : "Laptop/PC"
  } (${device.cameraAvailable ? "Kamera & " : ""}GPS)`;

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-slate-400" />
        )}
        <Info size={15} className="shrink-0 text-slate-400" />
        <span>Info Perangkat</span>
        <span className="ml-auto text-xs font-normal text-slate-400">{summary}</span>
      </button>

      {open ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-slate-100 px-4 py-3 text-xs text-slate-600 sm:grid-cols-2">
          <dt className="text-slate-400">Browser</dt>
          <dd className="text-right font-medium">{device.browser}</dd>
          <dt className="text-slate-400">Sistem Operasi</dt>
          <dd className="text-right font-medium">{device.os}</dd>
          <dt className="text-slate-400">Kategori perangkat</dt>
          <dd className="text-right font-medium">{device.category}</dd>
          <dt className="text-slate-400">Kamera tersedia</dt>
          <dd className="text-right font-medium">
            {device.cameraAvailable === null ? "Tidak diketahui" : device.cameraAvailable ? "Ya" : "Tidak"}
          </dd>
          <dt className="text-slate-400">Lokasi tersedia</dt>
          <dd className="text-right font-medium">{device.locationAvailable ? "Ya" : "Tidak"}</dd>
          <dt className="text-slate-400">Izin kamera</dt>
          <dd className="text-right font-medium">{PERMISSION_LABEL[device.cameraPermission]}</dd>
          <dt className="text-slate-400">Izin lokasi</dt>
          <dd className="text-right font-medium">{PERMISSION_LABEL[device.locationPermission]}</dd>
        </dl>
      ) : null}
    </div>
  );
}
