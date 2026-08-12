/**
 * useAttendanceVerification — owns the complete Absensi verification lifecycle
 * (TODO.md FR-001): camera MediaStream with capture/retake, one-shot
 * geolocation with retry + timeout, operational device info, readiness, and a
 * strict cleanup contract (unmount/route-change/StrictMode-safe; a single
 * streamRef owner so streams never accumulate).
 *
 * Submission is gated on: photo captured AND location found (readiness.complete)
 * — camera stream running alone is NOT enough (fixes the previous bug).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { collectDeviceInfo, type DeviceInfo } from "./deviceInfo";

export type CameraState =
  | "idle"
  | "requesting"
  | "active"
  | "captured"
  | "denied"
  | "unavailable"
  | "in_use"
  | "error";

export type LocationState =
  | "idle"
  | "requesting"
  | "found"
  | "low_accuracy"
  | "denied"
  | "unavailable"
  | "timeout"
  | "error";

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
  permissionState: string;
  acquisitionStatus: string;
}

export interface VerificationState {
  camera: CameraState;
  locationState: LocationState;
  photo: { dataUrl: string | null; mediaRef: string | null; capturedAt: string | null };
  location: GeoLocation | null;
  device: DeviceInfo | null;
}

const initialState: VerificationState = {
  camera: "idle",
  locationState: "idle",
  photo: { dataUrl: null, mediaRef: null, capturedAt: null },
  location: null,
  device: null,
};

const LOCATION_TIMEOUT_MS = 15000;

export function useAttendanceVerification() {
  const [state, setState] = useState<VerificationState>(initialState);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const locationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false); // StrictMode double-mount guard

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    startedRef.current = false;
  }, []);

  const startCamera = useCallback(async () => {
    // Single-owner stream: never accumulate streams.
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({ ...s, camera: "unavailable" }));
      return;
    }
    setState((s) => ({ ...s, camera: "requesting" }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      startedRef.current = true;
      // The <video> element binds the stream on mount via `attachVideo`;
      // at this point the element may not exist yet (state flips to "active"
      // right after), so we never set srcObject here.
      setState((s) => ({
        ...s,
        camera: "active",
        photo: { dataUrl: null, mediaRef: null, capturedAt: null },
      }));
    } catch (err) {
      const name = (err as DOMException)?.name;
      let camera: CameraState = "error";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") camera = "denied";
      else if (name === "NotFoundError" || name === "OverconstrainedError") camera = "unavailable";
      else if (name === "NotReadableError") camera = "in_use";
      setState((s) => ({ ...s, camera }));
    }
  }, [stopCamera]);

  /**
   * Ref callback for the live <video> element: records the node and binds the
   * current MediaStream when present. This runs when the element mounts — i.e.
   * AFTER startCamera resolved — so the stream is attached at the right time.
   */
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => undefined);
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Keep exactly what is in the frame: the live preview is mirrored
    // (selfie view), so the capture mirrors the same way — never reverse it.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    // Release the live stream after capture; retake restarts it fresh.
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState((s) => ({
      ...s,
      camera: "captured",
      photo: { dataUrl, mediaRef: null, capturedAt: new Date().toISOString() },
    }));
  }, []);

  const retake = useCallback(() => {
    stopCamera();
    setState((s) => ({
      ...s,
      camera: "idle",
      photo: { dataUrl: null, mediaRef: null, capturedAt: null },
    }));
  }, [stopCamera]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, locationState: "unavailable" }));
      return;
    }
    setState((s) => ({ ...s, locationState: "requesting" }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (locationTimerRef.current) {
          clearTimeout(locationTimerRef.current);
          locationTimerRef.current = null;
        }
        const accuracy = Math.round(position.coords.accuracy);
        const loc: GeoLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy,
          timestamp: new Date(position.timestamp).toISOString(),
          permissionState: "granted",
          acquisitionStatus: "found",
        };
        setState((s) => ({
          ...s,
          location: loc,
          locationState: accuracy > 100 ? "low_accuracy" : "found",
        }));
      },
      (err) => {
        if (locationTimerRef.current) {
          clearTimeout(locationTimerRef.current);
          locationTimerRef.current = null;
        }
        if (err.code === err.PERMISSION_DENIED) setState((s) => ({ ...s, locationState: "denied" }));
        else if (err.code === err.POSITION_UNAVAILABLE) setState((s) => ({ ...s, locationState: "unavailable" }));
        else setState((s) => ({ ...s, locationState: "error" }));
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 }
    );
    locationTimerRef.current = setTimeout(() => {
      setState((s) => ({ ...s, locationState: "timeout" }));
    }, LOCATION_TIMEOUT_MS);
  }, []);

  // Refresh device info once on mount.
  useEffect(() => {
    let alive = true;
    collectDeviceInfo().then((device) => {
      if (alive) setState((s) => ({ ...s, device }));
    });
    return () => {
      alive = false;
    };
  }, []);

  // Cleanup contract (FR-001/FR-009): stop stream + timers on unmount.
  useEffect(() => {
    return () => {
      stopCamera();
      if (locationTimerRef.current) {
        clearTimeout(locationTimerRef.current);
        locationTimerRef.current = null;
      }
    };
  }, [stopCamera]);

  const cameraReady = state.camera === "active" || state.camera === "captured";
  const photoCaptured = Boolean(state.photo.dataUrl);
  const locationReady = state.locationState === "found" || state.locationState === "low_accuracy";
  const complete = cameraReady && photoCaptured && locationReady;

  return {
    ...state,
    readiness: { cameraReady, photoCaptured, locationReady, complete },
    attachVideo,
    startCamera,
    stopCamera,
    capture,
    retake,
    requestLocation,
    retryLocation: requestLocation,
  };
}
