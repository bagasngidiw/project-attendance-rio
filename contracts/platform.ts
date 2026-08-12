/**
 * Platform branding DTO types (FR-001 + UIUXDESIGN.md product decision).
 * Customer controls only the IDENTITY; colors are product-controlled and
 * served from the fixed SIMBIKA palette as semantic tokens.
 */

import type { ApiEnvelope } from "./auth";

export type BrandingTokenKey =
  | "--brand-primary"
  | "--brand-on-primary"
  | "--brand-secondary"
  | "--brand-on-secondary"
  | "--brand-accent"
  | "--brand-background"
  | "--brand-surface"
  | "--brand-text"
  | "--brand-text-muted"
  | "--brand-border"
  | "--brand-success"
  | "--brand-warning"
  | "--brand-danger"
  | "--brand-info";

export type BrandingTokens = Record<BrandingTokenKey, string>;

export interface BrandingLogo {
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
}

export interface BrandingDto {
  applicationName: string;
  applicationShortName: string;
  logo: BrandingLogo | null;
  tokens: BrandingTokens;
}

/** Body accepted by PUT /platform/settings/branding (identity only). */
export interface BrandingUpdateDto {
  applicationName: string;
  applicationShortName: string;
  logo?: BrandingLogo | null;
}

export type BrandingResponse = ApiEnvelope<BrandingDto>;
export type BrandingLogoResponse = ApiEnvelope<{ logo: BrandingLogo | null }>;
