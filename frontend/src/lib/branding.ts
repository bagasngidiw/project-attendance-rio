/**
 * Runtime branding (FR-001 / FR-004) — anti-flash theme bootstrap + identity.
 *
 * The public branding endpoint is fetched before React renders so the app
 * paints immediately with the default tokens and swaps to the customer theme
 * without a blocking spinner. Only the KNOWN token keys are ever applied as
 * CSS custom properties; arbitrary user strings are never evaluated or
 * injected.
 */

import { useSyncExternalStore } from "react";

import type { BrandingDto, BrandingTokenKey, BrandingTokens } from "@contracts/platform";

import { brandingApi } from "@/lib/axios";

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

  state = {
    ...state,
    applicationName,
    applicationShortName,
    logoUrl: identity.logo?.url ?? null,
  };
  notify();
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
