/**
 * SalarySlipService (FR-006) — salary invoice slip upload/list/download.
 *
 * SUPERADMIN uploads a slip file to a specific ACTIVE user (form fields:
 * penerima, tanggal gajian, periode, keterangan, file). The file is stored on
 * local disk under `salary-assets/`; metadata lives in `salary_slips`. The
 * receiver gets an in-app notification (`salary.slip_uploaded`) and may list
 * (with sender name) and download their own slips. SUPERADMIN can list all
 * and download any. `storageKey` is NEVER exposed in any DTO.
 */

const crypto = require("crypto");
const path = require("path");
const { validateUpload } = require("../domain/attachment");
const { NotFoundError, ValidationError } = require("../domain/errors");

const SALARY_UPLOAD_POLICY = Object.freeze({
  allowedTypes: ["application/pdf", "image/png", "image/jpeg"],
  maxSizeBytes: 5 * 1024 * 1024,
});

/** Display-safe original name: basename only, no separators/traversal. */
function displayFileName(originalName) {
  const base = path.basename(String(originalName ?? ""));
  return base.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "file";
}

class SalarySlipService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/salary-slip.repository').SalarySlipRepository} deps.salarySlipRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/storage/local-disk.storage').LocalDiskStorage} deps.storage
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   */
  constructor({ salarySlipRepository, userRepository, storage, auditService, eventBus }) {
    this.salarySlipRepository = salarySlipRepository;
    this.userRepository = userRepository;
    this.storage = storage;
    this.auditService = auditService;
    this.eventBus = eventBus;
  }

  /**
   * Uploads a salary slip for a receiver (SUPERADMIN only — enforced by the
   * `salary:manage` route guard; re-checked here via permission defense in
   * depth).
   *
   * @param {{ userId: string, file: { originalname: string, mimetype: string, size: number, buffer: Buffer }, sender: object, payDate: Date, periodLabel: string, notes?: string }} input
   */
  async upload({ userId, file, sender = {}, payDate, periodLabel, notes = "" }) {
    if (!file || !file.buffer) {
      throw new ValidationError("A file is required.", { field: "file" });
    }
    if (!(sender.actorPermissions ?? []).includes("salary:manage")) {
      throw new ValidationError(
        "Hanya superadmin yang dapat mengunggah slip gaji.",
        { field: "permission" }
      );
    }

    const receiver = await this.userRepository.assertExists(userId);
    if (receiver.status !== "ACTIVE") {
      throw new ValidationError("Penerima tidak aktif.", { field: "userId" });
    }

    validateUpload(
      {
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalName: file.originalname,
      },
      SALARY_UPLOAD_POLICY
    );

    // Random opaque token filename — never derived from the client name.
    const ext = path.extname(file.originalname).slice(0, 16);
    const storageKey = `slip-${crypto.randomBytes(16).toString("hex")}${ext}`;
    await this.storage.save({ key: storageKey, buffer: file.buffer });

    const record = await this.salarySlipRepository.create({
      userId,
      senderId: sender.actorId ?? null,
      payDate,
      periodLabel,
      notes: notes ?? "",
      fileName: displayFileName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey,
    });

    await this.recordAudit("SALARY.UPLOADED", record, sender);

    if (this.eventBus) {
      await this.eventBus.publish("salary.slip_uploaded", {
        userId,
        slipId: this.id(record),
        periodLabel,
        payDate,
      });
    }

    const senderName = await this.resolveName(record.senderId);
    return this.toDto(record, senderName);
  }

  /**
   * Lists the caller's own slips (newest pay date first) with sender names.
   *
   * @param {{ userId: string, page?: number, pageSize?: number }} input
   */
  async listMine({ userId, page = 1, pageSize = 20 }) {
    const { items, total } = await this.salarySlipRepository.listByUser(userId, { page, pageSize });
    return this.paginate(items, total, page, pageSize);
  }

  /** Lists every slip (SUPERADMIN surface, `salary:manage`). */
  async listAll({ page = 1, pageSize = 20 }) {
    const { items, total } = await this.salarySlipRepository.listAll({ page, pageSize });
    return this.paginate(items, total, page, pageSize);
  }

  /**
   * Downloads a slip for the receiver or a `salary:manage` holder. Denied
   * access answers 404 (no existence leak).
   *
   * @param {{ slipId: string, actor: object }} input
   * @returns {Promise<{ buffer: Buffer, record: object }>}
   */
  async download({ slipId, actor = {} }) {
    const record = await this.salarySlipRepository.findById(slipId);
    if (!record) {
      throw new NotFoundError("Salary slip not found.", "SALARY_SLIP_NOT_FOUND");
    }
    const isReceiver = String(record.userId) === String(actor.actorId);
    const isManager = (actor.actorPermissions ?? []).includes("salary:manage");
    if (!isReceiver && !isManager) {
      throw new NotFoundError("Salary slip not found.", "SALARY_SLIP_NOT_FOUND");
    }

    const buffer = await this.storage.read(record.storageKey);
    await this.recordAudit("SALARY.DOWNLOADED", record, actor);
    return { buffer, record };
  }

  /* ---------------- helpers ---------------- */

  async paginate(items, total, page, pageSize) {
    const userIds = [...new Set(items.map((i) => String(i.userId)).filter(Boolean))];
    const senderIds = [...new Set(items.map((i) => String(i.senderId)).filter(Boolean))];
    const [users, senders] = await Promise.all([
      userIds.length ? this.userRepository.findByIds(userIds) : [],
      senderIds.length ? this.userRepository.findByIds(senderIds) : [],
    ]);
    const nameById = new Map(
      [...users, ...senders].map((s) => [String(s.id ?? s._id), s.name ?? s.username])
    );
    return {
      items: items.map((item) =>
        this.toDto(
          item,
          nameById.get(String(item.senderId)) ?? null,
          nameById.get(String(item.userId)) ?? null
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  async resolveName(userId) {
    if (!userId) return null;
    const user = await this.userRepository.findById(userId);
    return user ? user.name ?? user.username : null;
  }

  async recordAudit(action, record, actor = {}) {
    await this.auditService.record({
      action,
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "SALARY_SLIP",
        id: this.id(record),
        summary: record.periodLabel,
      },
      outcome: "SUCCESS",
      metadata: {
        slipId: this.id(record),
        userId: record.userId?.toString?.() ?? record.userId,
        periodLabel: record.periodLabel,
        fileName: record.fileName,
        sizeBytes: record.sizeBytes,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }

  /**
   * Plain metadata DTO — `storageKey` NEVER crosses the boundary.
   */
  toDto(record, senderName = null, receiverName = null) {
    return {
      id: this.id(record),
      userId: record.userId?.toString?.() ?? record.userId,
      receiverName,
      senderId: record.senderId?.toString?.() ?? record.senderId,
      senderName,
      payDate: record.payDate ? record.payDate.toISOString?.() ?? record.payDate : null,
      periodLabel: record.periodLabel,
      notes: record.notes ?? "",
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt ? record.createdAt.toISOString?.() ?? record.createdAt : null,
    };
  }

  id(doc) {
    return String(doc.id ?? doc._id);
  }
}

module.exports = { SalarySlipService };