/**
 * BrandingService (FR-001/FR-002/FR-007) — platform branding surface.
 *
 * Customer-configurable COLORS are removed (product decision): the customer
 * controls only identity (name, short name, logo); the color tokens always
 * come from the fixed SIMBIKA product palette.
 *
 * Responsibilities:
 *   - getBranding(): identity + the FIXED token map
 *   - updateBranding(): validates + persists identity (+ committed logo
 *     reference), audited as SETTINGS.CHANGED with changed fields
 *   - uploadLogo(): stages a logo asset (validate type/size, sanitize SVG,
 *     store to disk, return a reference used on save)
 *   - removeLogo(): removes the staged/persisted logo asset
 *   - getAsset(): serves a stored branding asset with safe headers
 *
 * Guarded by `platform:settings` at the route layer.
 */

const crypto = require("crypto");
const {
  validateBranding,
  normalizeBranding,
  toThemeTokens,
} = require("../domain/branding");
const { sanitizeSvg } = require("../infrastructure/svg-sanitizer");
const { ValidationError, NotFoundError } = require("../domain/errors");

const BRANDING_KEY = "branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_TYPES = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
});

class BrandingService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/storage/local-disk.storage').LocalDiskStorage} deps.logoStorage
   */
  constructor({ platformSettingRepository, auditService, logoStorage }) {
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
    this.logoStorage = logoStorage;
  }

  /** FR-001: current branding (defaults when never configured). */
  async getBranding() {
    const stored = await this.platformSettingRepository.get(BRANDING_KEY);
    const branding = normalizeBranding(stored);
    return {
      ...branding,
      tokens: toThemeTokens(branding),
    };
  }

  /**
   * FR-001: validates + persists the customer identity (colors are ignored —
   * the product owns the palette). Audits SETTINGS.CHANGED with the changed
   * identity fields.
   *
   * @param {{ applicationName: string, applicationShortName: string, logo?: object|null }} input
   * @param {object} actor
   */
  async updateBranding(input, actor = {}) {
    const validated = validateBranding(input);
    const oldValue = await this.platformSettingRepository.get(BRANDING_KEY);
    const before = normalizeBranding(oldValue);

    const changedFields = [];
    if (before.applicationName !== validated.applicationName) changedFields.push("applicationName");
    if (before.applicationShortName !== validated.applicationShortName) changedFields.push("applicationShortName");
    if (JSON.stringify(before.logo ?? null) !== JSON.stringify(validated.logo ?? null)) changedFields.push("logo");

    const persisted = {
      applicationName: validated.applicationName,
      applicationShortName: validated.applicationShortName,
      logo: validated.logo,
      updatedAt: new Date().toISOString(),
    };
    await this.platformSettingRepository.set(BRANDING_KEY, persisted, actor.actorId ?? null);

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: BRANDING_KEY, summary: "branding" },
      outcome: "SUCCESS",
      metadata: {
        setting: BRANDING_KEY,
        changedFields,
        oldValues: { applicationName: before.applicationName, applicationShortName: before.applicationShortName, logo: before.logo ?? null },
        newValues: { applicationName: validated.applicationName, applicationShortName: validated.applicationShortName, logo: validated.logo ?? null },
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    const branding = normalizeBranding(persisted);
    return { ...branding, tokens: toThemeTokens(branding) };
  }

  /**
   * FR-002: stages a logo asset. Validates type/size, sanitizes SVG, stores it
   * and returns a reference consumed by the branding save. The persisted
   * branding is NOT changed until `updateBranding` is called.
   *
   * @param {{ originalname?: string, mimetype?: string, size?: number, buffer?: Buffer }} file
   * @param {object} actor
   */
  async uploadLogo(file, actor = {}) {
    if (!file || !file.buffer) {
      throw new ValidationError("File logo wajib disertakan.", { field: "file" });
    }
    const ext = ALLOWED_LOGO_TYPES[file.mimetype];
    if (!ext) {
      throw new ValidationError(
        "Format logo tidak didukung. Gunakan PNG, JPG, atau SVG.",
        { field: "file" }
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new ValidationError("Ukuran logo maksimal 2 MB.", { field: "file" });
    }

    let buffer = file.buffer;
    if (file.mimetype === "image/svg+xml") {
      const sanitized = sanitizeSvg(buffer.toString("utf8"));
      if (!sanitized) {
        throw new ValidationError("Logo SVG tidak valid.", { field: "file" });
      }
      buffer = Buffer.from(sanitized, "utf8");
    }

    // Flat single-segment key so the public asset route `/:token` matches.
    const key = `logo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    await this.logoStorage.save({ key, buffer });

    const logo = {
      url: `/api/v1/platform/branding-assets/${key}`,
      fileName: file.originalname ?? "logo",
      contentType: file.mimetype,
      sizeBytes: buffer.length,
      updatedAt: new Date().toISOString(),
    };

    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: BRANDING_KEY, summary: "branding logo staged" },
      outcome: "SUCCESS",
      metadata: { setting: BRANDING_KEY, changedFields: ["logo"], stage: "upload", contentType: file.mimetype, sizeBytes: buffer.length },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { logo };
  }

  /**
   * FR-002: removes the staged/persisted logo asset (best-effort delete).
   *
   * @param {object} actor
   */
  async removeLogo(actor = {}) {
    const stored = await this.platformSettingRepository.get(BRANDING_KEY);
    const logo = normalizeBranding(stored).logo;
    if (logo?.url) {
      const key = logo.url.split("/branding-assets/")[1];
      if (key) await this.logoStorage.delete(key);
    }
    await this.auditService.record({
      action: "SETTINGS.CHANGED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "SETTING", id: BRANDING_KEY, summary: "branding logo removed" },
      outcome: "SUCCESS",
      metadata: { setting: BRANDING_KEY, changedFields: ["logo"], stage: "remove" },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { logo: null };
  }

  /** FR-002: serves a stored branding asset (safe headers applied at route). */
  async getAsset(token) {
    try {
      const buffer = await this.logoStorage.read(token);
      const ext = String(token).split(".").pop();
      const contentType = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
      return { buffer, contentType };
    } catch (err) {
      throw new NotFoundError("Aset tidak ditemukan.", "BRANDING_ASSET_NOT_FOUND");
    }
  }
}

module.exports = { BrandingService, BRANDING_KEY, ALLOWED_LOGO_TYPES, MAX_LOGO_BYTES };
