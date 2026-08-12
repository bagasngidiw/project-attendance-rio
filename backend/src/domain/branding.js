/**
 * Branding domain model (FR-001 + UIUXDESIGN.md product decision).
 *
 * Customer-configurable colors are REMOVED. The customer controls only the
 * application IDENTITY (name, short name, logo); the application's colors come
 * from a single FIXED product design system (SIMBIKA palette) shared by every
 * component.
 *
 * Pure: identity validation/defaults + the fixed token map. No I/O.
 */

const { ValidationError } = require("./errors");

/**
 * Fixed SIMBIKA product palette — the single source of truth for all colors.
 * Customers cannot modify these (they are not Platform Settings).
 */
const PRODUCT_PALETTE = Object.freeze({
  primary: "#D90429", // brand red — primary actions, active nav, CTA
  secondary: "#FF6B00", // brand orange — secondary actions, supporting brand
  accent: "#FF8A00", // accent orange — subtle supporting highlights
  background: "#F7F8FA", // page background (soft gray)
  surface: "#FFFFFF", // cards / forms / modals / dropdowns
  text: "#111827", // primary text (dark gray)
  textMuted: "#64748B", // secondary/muted text (slate)
  border: "#E2E8F0", // borders / dividers (light slate)
  success: "#16A34A",
  warning: "#F59E0B",
  danger: "#DC2626",
  info: "#2563EB",
});

const DEFAULT_BRANDING = Object.freeze({
  applicationName: "Sistem Informasi Sumber Daya Manusia",
  applicationShortName: "HRIS",
  logo: null, // { url, fileName, contentType, sizeBytes, updatedAt }
});

/**
 * Validates + normalizes the customer-controlled identity. Any `colors` field
 * in the input is deliberately IGNORED — colors are product-controlled.
 *
 * @param {{ applicationName?: string, applicationShortName?: string, logo?: object|null }} input
 */
function validateBranding(input = {}) {
  const applicationName = String(input.applicationName ?? "").trim();
  if (!applicationName) {
    throw new ValidationError("Nama aplikasi wajib diisi.", { field: "applicationName" });
  }
  if (applicationName.length > 80) {
    throw new ValidationError("Nama aplikasi maksimal 80 karakter.", { field: "applicationName" });
  }

  const applicationShortName = String(input.applicationShortName ?? "").trim();
  if (!applicationShortName) {
    throw new ValidationError("Nama singkatan aplikasi wajib diisi.", { field: "applicationShortName" });
  }
  if (applicationShortName.length > 16) {
    throw new ValidationError("Nama singkatan maksimal 16 karakter.", { field: "applicationShortName" });
  }

  let logo = null;
  if (input.logo && typeof input.logo === "object") {
    logo = {
      url: input.logo.url ?? null,
      fileName: input.logo.fileName ?? null,
      contentType: input.logo.contentType ?? null,
      sizeBytes: input.logo.sizeBytes ?? null,
      updatedAt: input.logo.updatedAt ?? null,
    };
  }

  return { applicationName, applicationShortName, logo };
}

/**
 * Merges a stored identity value over defaults (legacy color fields are
 * ignored — they are no longer used).
 *
 * @param {object|null|undefined} stored
 */
function normalizeBranding(stored) {
  if (!stored || typeof stored !== "object") {
    return {
      applicationName: DEFAULT_BRANDING.applicationName,
      applicationShortName: DEFAULT_BRANDING.applicationShortName,
      logo: null,
    };
  }
  return {
    applicationName:
      typeof stored.applicationName === "string" && stored.applicationName.trim()
        ? stored.applicationName.trim()
        : DEFAULT_BRANDING.applicationName,
    applicationShortName:
      typeof stored.applicationShortName === "string" && stored.applicationShortName.trim()
        ? stored.applicationShortName.trim()
        : DEFAULT_BRANDING.applicationShortName,
    logo: stored.logo && typeof stored.logo === "object" ? stored.logo : null,
  };
}

/**
 * The fixed semantic token map the runtime applies as CSS custom properties.
 * Colors are always the product palette — never customer-supplied.
 *
 * @param {object} [_branding] accepted for signature compatibility; ignored
 */
function toThemeTokens(_branding) {
  const p = PRODUCT_PALETTE;
  return {
    "--brand-primary": p.primary,
    "--brand-on-primary": "#FFFFFF",
    "--brand-secondary": p.secondary,
    "--brand-on-secondary": "#111827",
    "--brand-accent": p.accent,
    "--brand-background": p.background,
    "--brand-surface": p.surface,
    "--brand-text": p.text,
    "--brand-text-muted": p.textMuted,
    "--brand-border": p.border,
    "--brand-success": p.success,
    "--brand-warning": p.warning,
    "--brand-danger": p.danger,
    "--brand-info": p.info,
  };
}

module.exports = {
  PRODUCT_PALETTE,
  DEFAULT_BRANDING,
  validateBranding,
  normalizeBranding,
  toThemeTokens,
};
