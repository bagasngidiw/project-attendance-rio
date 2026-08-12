/**
 * deviceInfo.ts — pure browser-capability detection for the Absensi
 * verification flow (TODO.md FR-001/FR-004). Operational metadata only:
 * category/browser/OS/availability/permission states. Never fingerprinting,
 * never sensitive data.
 */

export interface DeviceInfo {
  category: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
  cameraAvailable: boolean | null;
  locationAvailable: boolean;
  cameraPermission: "granted" | "denied" | "prompt" | "unknown";
  locationPermission: "granted" | "denied" | "prompt" | "unknown";
}

export function detectDeviceCategory(): DeviceInfo["category"] {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPod|Mobile/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua) || (isMobile && !/Mobile/i.test(ua) && /Android/i.test(ua));
  if (isTablet) return "tablet";
  if (isMobile) return "mobile";
  return "desktop";
}

export function detectBrowser(): string {
  if (typeof navigator === "undefined") return "Tidak diketahui";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Tidak diketahui";
}

export function detectOs(): string {
  if (typeof navigator === "undefined") return "Tidak diketahui";
  const p = navigator.platform || "";
  const ua = navigator.userAgent;
  if (/Win/.test(p)) return "Windows";
  if (/Mac/.test(p)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(p)) return "Linux";
  return "Tidak diketahui";
}

/** Enumerates video-input devices (best-effort; may be null on browsers
 *  that hide device labels until permission is granted). */
export async function detectCameraAvailable(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return null;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return null;
  }
}

export function detectLocationAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation);
}

/** Best-effort permission states via the Permissions API (may be unknown). */
export async function detectPermissionStates(): Promise<{
  cameraPermission: DeviceInfo["cameraPermission"];
  locationPermission: DeviceInfo["locationPermission"];
}> {
  const result = { cameraPermission: "unknown" as DeviceInfo["cameraPermission"], locationPermission: "unknown" as DeviceInfo["locationPermission"] };
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return result;
  try {
    const cam = await navigator.permissions.query({ name: "camera" as PermissionName });
    result.cameraPermission = cam.state;
  } catch {
    // not supported
  }
  try {
    const loc = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    result.locationPermission = loc.state;
  } catch {
    // not supported
  }
  return result;
}

export async function collectDeviceInfo(): Promise<DeviceInfo> {
  const [cameraAvailable, perms] = await Promise.all([
    detectCameraAvailable(),
    detectPermissionStates(),
  ]);
  return {
    category: detectDeviceCategory(),
    browser: detectBrowser(),
    os: detectOs(),
    cameraAvailable,
    locationAvailable: detectLocationAvailable(),
    cameraPermission: perms.cameraPermission,
    locationPermission: perms.locationPermission,
  };
}
