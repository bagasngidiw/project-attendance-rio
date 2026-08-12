/**
 * Branding domain tests (FR-001 + UIUXDESIGN.md product decision): identity
 * validation/defaults and the FIXED SIMBIKA token map. Customer colors are
 * gone — the product owns the palette.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  PRODUCT_PALETTE,
  DEFAULT_BRANDING,
  validateBranding,
  normalizeBranding,
  toThemeTokens,
} = require("../../src/domain/branding");

test("fixed product palette is complete", () => {
  assert.equal(PRODUCT_PALETTE.primary, "#D90429");
  assert.equal(PRODUCT_PALETTE.secondary, "#FF6B00");
  assert.equal(PRODUCT_PALETTE.background, "#F7F8FA");
  assert.equal(PRODUCT_PALETTE.surface, "#FFFFFF");
  assert.equal(PRODUCT_PALETTE.text, "#111827");
  assert.equal(PRODUCT_PALETTE.border, "#E2E8F0");
});

test("identity defaults exist", () => {
  assert.equal(DEFAULT_BRANDING.applicationName, "Sistem Informasi Sumber Daya Manusia");
  assert.equal(DEFAULT_BRANDING.applicationShortName, "HRIS");
  assert.equal(DEFAULT_BRANDING.logo, null);
});

test("validateBranding accepts a valid identity and trims", () => {
  const result = validateBranding({
    applicationName: "  Sistem HR  ",
    applicationShortName: " hris ",
  });
  assert.equal(result.applicationName, "Sistem HR");
  assert.equal(result.applicationShortName, "hris");
  assert.equal(result.logo, null);
});

test("validateBranding rejects missing/oversized names", () => {
  assert.throws(() => validateBranding({ applicationShortName: "HRIS" }), /Nama aplikasi wajib/);
  assert.throws(
    () => validateBranding({ applicationName: "A", applicationShortName: "" }),
    /Nama singkatan aplikasi wajib/
  );
  assert.throws(
    () => validateBranding({ applicationName: "x".repeat(81), applicationShortName: "X" }),
    /maksimal 80 karakter/
  );
  assert.throws(
    () => validateBranding({ applicationName: "X", applicationShortName: "x".repeat(17) }),
    /maksimal 16 karakter/
  );
});

test("validateBranding ignores any colors in the input (product-controlled)", () => {
  const result = validateBranding({
    applicationName: "X",
    applicationShortName: "X",
    colors: { primary: "#D90429", surface: "#000000" },
  });
  assert.equal(result.colors, undefined, "colors are deliberately ignored");
});

test("normalizeBranding falls back per identity key and ignores legacy colors", () => {
  const result = normalizeBranding({ applicationName: "  ", colors: { primary: "#123456" } });
  assert.equal(result.applicationName, DEFAULT_BRANDING.applicationName, "blank name falls back");
  assert.equal(result.colors, undefined, "legacy stored colors are ignored");
  const partial = normalizeBranding({ applicationName: "Custom", applicationShortName: "CUS" });
  assert.equal(partial.applicationName, "Custom");
  assert.equal(partial.applicationShortName, "CUS");
});

test("toThemeTokens emits the fixed product tokens", () => {
  const tokens = toThemeTokens();
  assert.equal(tokens["--brand-primary"], "#D90429");
  assert.equal(tokens["--brand-on-primary"], "#FFFFFF");
  assert.equal(tokens["--brand-secondary"], "#FF6B00");
  assert.equal(tokens["--brand-background"], "#F7F8FA");
  assert.equal(tokens["--brand-surface"], "#FFFFFF");
  assert.equal(tokens["--brand-text"], "#111827");
  assert.equal(tokens["--brand-text-muted"], "#64748B");
  assert.equal(tokens["--brand-border"], "#E2E8F0");
  assert.equal(tokens["--brand-success"], "#16A34A");
  assert.equal(tokens["--brand-warning"], "#F59E0B");
  assert.equal(tokens["--brand-danger"], "#DC2626");
  assert.equal(tokens["--brand-info"], "#2563EB");
});
