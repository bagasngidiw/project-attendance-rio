/**
 * Runtime branding (FR-001 / FR-004) — anti-flash theme bootstrap + identity.
 *
 * The public branding endpoint is fetched before React renders so the app
 * paints immediately with the default tokens and swaps to the customer theme
 * without a blocking spinner. Only the KNOWN token keys are ever applied as
 * CSS custom properties; arbitrary user strings are never evaluated or
 * injected.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import type { BrandingDto, BrandingTokenKey, BrandingTokens } from "@contracts/platform";

import { brandingApi, fetchBlobObjectUrl } from "@/lib/axios";

/** The token keys the client applies to the document (fixed product palette). */
export const TOKEN_KEYS: BrandingTokenKey[] = [
  "--brand-primary",
  "--brand-on-primary",
  "--brand-secondary",
  "--brand-on-secondary",
  "--brand-accent",
  "--brand-background",
  "--brand-surface",
  "--brand-text",
  "--brand-text-muted",
  "--brand-border",
  "--brand-success",
  "--brand-warning",
  "--brand-danger",
  "--brand-info",
];

/** Fixed SIMBIKA product palette — not customer-configurable. */
export const DEFAULT_TOKENS: BrandingTokens = {
  "--brand-primary": "#D90429",
  "--brand-on-primary": "#FFFFFF",
  "--brand-secondary": "#FF6B00",
  "--brand-on-secondary": "#111827",
  "--brand-accent": "#FF8A00",
  "--brand-background": "#F7F8FA",
  "--brand-surface": "#FFFFFF",
  "--brand-text": "#111827",
  "--brand-text-muted": "#64748B",
  "--brand-border": "#E2E8F0",
  "--brand-success": "#16A34A",
  "--brand-warning": "#F59E0B",
  "--brand-danger": "#DC2626",
  "--brand-info": "#2563EB",
};

export const DEFAULT_APPLICATION_NAME = "Sistem Informasi Sumber Daya Manusia";
export const DEFAULT_APPLICATION_SHORT_NAME = "HRIS";

export interface BrandingState {
  applicationName: string;
  applicationShortName: string;
  logoUrl: string | null;
  tokens: BrandingTokens;
}

const DEFAULT_STATE: BrandingState = {
  applicationName: DEFAULT_APPLICATION_NAME,
  applicationShortName: DEFAULT_APPLICATION_SHORT_NAME,
  logoUrl: null,
  tokens: DEFAULT_TOKENS,
};

let state: BrandingState = DEFAULT_STATE;
const listeners = new Set<() => void>();

/**
 * Object URL currently applied as the logo (created from a blob fetched via
 * the header-carrying axios client). Revoked when replaced or removed so the
 * branding store never leaks blob URLs.
 */
let currentLogoObjectUrl: string | null = null;

/**
 * Monotonic generation for the async logo resolution. Bumped on every
 * applyIdentity call so a slow blob fetch for an outdated logo can never
 * overwrite a newer one.
 */
let identityGeneration = 0;

function revokeLogoObjectUrl(): void {
  if (currentLogoObjectUrl) {
    URL.revokeObjectURL(currentLogoObjectUrl);
    currentLogoObjectUrl = null;
  }
}

/**
 * Upgrades a relative /api logo URL to a blob object URL fetched through the
 * shared axios instance (which carries the ngrok-skip-browser-warning header).
 * Falls back to the raw relative URL on failure so bootstrap never breaks.
 */
async function resolveLogoObjectUrl(rawUrl: string, generation: number): Promise<void> {
  try {
    const objectUrl = await fetchBlobObjectUrl(rawUrl);
    if (generation !== identityGeneration) {
      // A newer identity replaced this one while the fetch was in flight.
      URL.revokeObjectURL(objectUrl);
      return;
    }
    revokeLogoObjectUrl();
    currentLogoObjectUrl = objectUrl;
    state = { ...state, logoUrl: objectUrl };
    notify();
  } catch {
    // Keep the raw relative URL (pre-upgrade behavior) when the asset cannot
    // be fetched — never break the branding bootstrap.
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BrandingState {
  return state;
}

/**
 * Applies ONLY the known token keys as CSS custom properties on `:root`.
 * Unknown keys present in the payload are ignored — never arbitrary strings.
 */
export function applyBrandingTokens(tokens: Partial<BrandingTokens>): void {
  const style = document.documentElement.style;
  for (const key of TOKEN_KEYS) {
    const value = tokens[key];
    if (typeof value === "string" && value.length > 0) {
      style.setProperty(key, value);
    }
  }
}

/**
 * Stores the platform identity in the module cache and syncs the document
 * title. Falls back to defaults so a partial payload never renders empty.
 */
export function applyIdentity(identity: {
  applicationName: string;
  applicationShortName: string;
  logo: { url?: string } | null;
}): void {
  const applicationName = identity.applicationName.trim() || DEFAULT_APPLICATION_NAME;
  const applicationShortName =
    identity.applicationShortName.trim() || DEFAULT_APPLICATION_SHORT_NAME;

  document.title = applicationName;

  const rawLogoUrl = identity.logo?.url ?? null;

  state = {
    ...state,
    applicationName,
    applicationShortName,
    logoUrl: rawLogoUrl,
  };
  notify();

  // Upgrade a relative /api logo URL to a blob object URL fetched through the
  // axios client. This is what makes the logo render on Vercel when the
  // backend is behind ngrok: raw browser <img> requests cannot send the
  // ngrok-skip-browser-warning header, but axios requests can.
  identityGeneration += 1;
  if (!rawLogoUrl || !rawLogoUrl.startsWith("/api/")) {
    revokeLogoObjectUrl();
    return;
  }
  void resolveLogoObjectUrl(rawLogoUrl, identityGeneration);
}

/** Applies a full branding payload (tokens + identity). */
export function applyBranding(branding: BrandingDto): void {
  applyBrandingTokens(branding.tokens);
  applyIdentity(branding);
}

/**
 * FR-004 anti-flash bootstrap: defaults are applied synchronously, then the
 * public theme is fetched and swapped in when it resolves. Safe to call from
 * main.tsx before React renders.
 */
export function bootstrapBranding(): void {
  applyBrandingTokens(DEFAULT_TOKENS);
  brandingApi
    .public()
    .then(({ data }) => {
      if (data?.data) applyBranding(data.data);
    })
    .catch(() => {
      /* keep defaults when the public endpoint is unreachable */
    });
}

/** Reactive branding state — components re-render when the async theme loads. */
export function useBranding(): BrandingState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Resolves a relative /api asset URL (e.g. a staged logo preview) to a blob
 * object URL fetched through the header-carrying axios client. Returns the raw
 * URL unchanged when it is not a relative /api path. When the fetch is pending
 * or fails, null is returned so callers can fall back to the raw URL. The
 * object URL is revoked automatically on unmount / path change.
 */
export function useAssetObjectUrl(rawUrl: string | null | undefined): string | null {
  const url = rawUrl ?? null;
  const isApiPath = !!url && url.startsWith("/api/");

  // Store the object URL together with the source path it was created from so
  // a stale blob from a previous logo can never be rendered for a new one.
  const [resolved, setResolved] = useState<{ url: string; objectUrl: string } | null>(null);

  useEffect(() => {
    if (!isApiPath || !url) return;

    let active = true;
    let created: string | null = null;

    fetchBlobObjectUrl(url)
      .then((obj) => {
        if (!active) {
          URL.revokeObjectURL(obj);
          return;
        }
        created = obj;
        setResolved({ url, objectUrl: obj });
      })
      .catch(() => {
        if (active) setResolved(null); // fall back to the raw relative URL
      });

    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [isApiPath, url]);

  // Non-relative paths are rendered as-is; relative /api paths render the
  // fetched object URL only while it matches the current source path.
  if (!isApiPath) return url;
  return resolved && resolved.url === url ? resolved.objectUrl : null;
}
