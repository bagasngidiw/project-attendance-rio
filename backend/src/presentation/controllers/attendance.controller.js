/**
 * AttendanceController — clock in/out, personal history, HR overview,
 * corrections (FR-035 / FR-020 / FR-041) and the selfie media surface
 * (TODO.md FR-008: upload + secure, RBAC-gated serving).
 */

const crypto = require("crypto");
const { attendanceQuerySchema } = require("../dto/attendance.dto");
const { ValidationError, NotFoundError, PermissionDeniedError } = require("../../domain/errors");

const MAX_MEDIA_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MEDIA_TYPES = new Set(["image/png", "image/jpeg"]);

class AttendanceController {
  constructor({ attendanceService, mediaStorage = null, auditService = null }) {
    this.attendanceService = attendanceService;
    this.mediaStorage = mediaStorage;
    this.auditService = auditService;
  }

  /** POST /attendance/clock-in */
  clockIn = async (req, res, next) => {
    try {
      const data = await this.attendanceService.clockIn(
        req.auth.userId,
        this.actor(req, req.body)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /attendance/clock-out */
  clockOut = async (req, res, next) => {
    try {
      const data = await this.attendanceService.clockOut(
        req.auth.userId,
        this.actor(req, req.body)
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /attendance/today — today's status for the clock panel. */
  today = async (req, res, next) => {
    try {
      const data = await this.attendanceService.getToday(req.auth.userId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /attendance/media (FR-008) — stage a captured selfie and return a
   * capability-token mediaRef included in the clock-in/out payload.
   */
  uploadMedia = async (req, res, next) => {
    try {
      if (!this.mediaStorage || !req.file) {
        throw new ValidationError("Berkas selfie diperlukan.", { field: "file" });
      }
      if (!ALLOWED_MEDIA_TYPES.has(req.file.mimetype)) {
        throw new ValidationError("Tipe berkas harus PNG atau JPG.", { field: "file" });
      }
      if (req.file.size > MAX_MEDIA_BYTES) {
        throw new ValidationError("Ukuran berkas melebihi 2 MB.", { field: "file" });
      }
      const token = crypto.randomBytes(24).toString("hex");
      const ext = req.file.mimetype === "image/png" ? "png" : "jpg";
      const key = `selfie_${token}.${ext}`;
      await this.mediaStorage.save({ key, buffer: req.file.buffer });
      await this.auditMediaAccess(key, req.auth.userId, "UPLOAD", req);
      res.status(201).json({
        data: {
          mediaRef: `/api/v1/attendance/media/${token}`,
          contentType: req.file.mimetype,
          sizeBytes: req.file.size,
          capturedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /** GET /attendance/media/:token (FR-008) — secure, RBAC-gated media fetch. */
  getMedia = async (req, res, next) => {
    try {
      if (!this.mediaStorage) throw new NotFoundError("Media not found.", "MEDIA_NOT_FOUND");
      const token = String(req.params.token || "");
      // Try both extensions; the token is the capability.
      let key = `selfie_${token}.png`;
      let file = await this.mediaStorage.read(key);
      if (!file) {
        key = `selfie_${token}.jpg`;
        file = await this.mediaStorage.read(key);
      }
      if (!file) throw new NotFoundError("Media not found.", "MEDIA_NOT_FOUND");
      await this.auditMediaAccess(key, req.auth.userId, "VIEW", req);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self' data:; sandbox"
      );
      res.type(key.endsWith(".png") ? "image/png" : "image/jpeg");
      res.send(file);
    } catch (err) {
      next(err);
    }
  };

  /** Access log for media (FR-008/FR-013): who viewed what, no content. */
  async auditMediaAccess(key, userId, action, req) {
    try {
      await this.auditService?.record?.({
        action: action === "UPLOAD" ? "ATTENDANCE.MEDIA_UPLOADED" : "ATTENDANCE.MEDIA_VIEWED",
        actor: { userId, roleKeys: req.auth?.roles ?? [] },
        subject: { type: "ATTENDANCE_MEDIA", id: key, summary: key },
        outcome: "SUCCESS",
        metadata: { key },
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
      });
    } catch {
      // Access logging must never break media serving.
    }
  }

  /** GET /attendance/me — personal history. */
  me = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.attendanceService.listOwn(req.auth.userId, filters);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /attendance/:id — scoped detail + correction history. */
  getById = async (req, res, next) => {
    try {
      const data = await this.attendanceService.getByIdScoped(req.params.id, req.auth.userId, {
        canViewAll: this.canViewAll(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /attendance — HR overview with filters. */
  overview = async (req, res, next) => {
    try {
      const filters = this.parseFilters(req.query);
      const data = await this.attendanceService.listOverview({
        actorId: req.auth.userId,
        canViewAll: this.canViewAll(req),
        filters,
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  /** POST /attendance/:id/correct — append-only correction. */
  correct = async (req, res, next) => {
    try {
      const data = await this.attendanceService.correct(req.params.id, req.body, this.actor(req));
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  canViewAll(req) {
    const perms = req.auth.permissions ?? [];
    return perms.includes("*") || perms.includes("attendance:view_all");
  }

  parseFilters(query) {
    const parsed = attendanceQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError("Invalid query filters.", {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  actor(req, body = {}) {
    // TODO.md FR-008/FR-009/FR-012/FR-006: verification + geolocation evidence
    // and operational device metadata flow with the clock event; the server
    // timestamp remains authoritative.
    return {
      actorId: req.auth.userId,
      actorRoleKeys: req.auth.roles,
      location: body.location ?? null,
      device: body.device ?? null,
      verification: body.camera
        ? { camera: body.camera, location: { status: body.location ? "found" : "", acquiredAt: null } }
        : null,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId,
    };
  }
}

module.exports = { AttendanceController };
