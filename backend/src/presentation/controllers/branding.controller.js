/**
 * BrandingController (FR-001/FR-002/FR-003) — platform branding surface,
 * guarded by `platform:settings`.
 */

class BrandingController {
  constructor({ brandingService }) {
    this.brandingService = brandingService;
  }

  /** GET /platform/settings/branding (admin — guarded at route). */
  get = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.brandingService.getBranding() });
    } catch (err) {
      next(err);
    }
  };

  /** GET /platform/branding (public runtime theme — identity + tokens). */
  getPublic = async (req, res, next) => {
    try {
      res.status(200).json({ data: await this.brandingService.getBranding() });
    } catch (err) {
      next(err);
    }
  };

  /** PUT /platform/settings/branding */
  update = async (req, res, next) => {
    try {
      const data = await this.brandingService.updateBranding(req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /platform/settings/branding/logo (multipart "file") */
  uploadLogo = async (req, res, next) => {
    try {
      const data = await this.brandingService.uploadLogo(req.file, this.actor(req));
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** DELETE /platform/settings/branding/logo */
  removeLogo = async (req, res, next) => {
    try {
      const data = await this.brandingService.removeLogo(this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /platform/branding-assets/:token (public branding asset). */
  getAsset = async (req, res, next) => {
    try {
      const { buffer, contentType } = await this.brandingService.getAsset(req.params.token);
      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (contentType === "image/svg+xml") {
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      }
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  actor(req) {
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { BrandingController };
