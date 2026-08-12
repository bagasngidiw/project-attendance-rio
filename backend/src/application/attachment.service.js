/**
 * AttachmentService (FR-017) — request-scoped file upload governance.
 *
 * Upload/list/download are access-checked against the owning request
 * (requester, assigned approver, or HR); delete additionally accepts the
 * `files:delete` permission. Denied access answers 404 so request existence
 * is never leaked. Every operation records an audit event
 * (FILE.UPLOADED / FILE.DOWNLOADED / FILE.DELETED).
 */

const { validateUpload, sanitizeStoredName } = require("../domain/attachment");
const { NotFoundError, ValidationError } = require("../domain/errors");

const DEFAULT_UPLOAD_POLICY = Object.freeze({
  allowedTypes: ["application/pdf", "image/png", "image/jpeg"],
  maxSizeBytes: 5 * 1024 * 1024,
});

const HR_ROLES = Object.freeze(["HR_ADMIN", "SUPER_ADMIN"]);
const HR_VIEW_PERMISSIONS = Object.freeze(["users:view", "attendance:view_all"]);

class AttachmentService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/attachment.repository').AttachmentRepository} deps.attachmentRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/storage/local-disk.storage').LocalDiskStorage} deps.storage
   * @param {import('../infrastructure/repositories/platform-setting.repository').PlatformSettingRepository} deps.platformSettingRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   * @param {import('./approval-configuration.service').ApprovalConfigurationService} [deps.approvalConfigurationService] FR-010 eligible-approver access
   */
  constructor({
    attachmentRepository,
    requestRepository,
    userRepository,
    storage,
    platformSettingRepository,
    auditService,
    approvalConfigurationService = null,
  }) {
    this.attachmentRepository = attachmentRepository;
    this.requestRepository = requestRepository;
    this.userRepository = userRepository;
    this.storage = storage;
    this.platformSettingRepository = platformSettingRepository;
    this.auditService = auditService;
    this.approvalConfigurationService = approvalConfigurationService;
  }

  /**
   * Reads the platform `fileUpload` policy, falling back to safe defaults when
   * unset or malformed.
   */
  async getUploadPolicy() {
    const stored = await this.platformSettingRepository.get("fileUpload");
    if (!stored || typeof stored !== "object") {
      return this.defaultPolicy();
    }
    return {
      allowedTypes: Array.isArray(stored.allowedTypes)
        ? [...stored.allowedTypes]
        : [...DEFAULT_UPLOAD_POLICY.allowedTypes],
      maxSizeBytes: Number.isFinite(stored.maxSizeBytes)
        ? stored.maxSizeBytes
        : DEFAULT_UPLOAD_POLICY.maxSizeBytes,
    };
  }

  /**
   * Validates and stores an uploaded file for a request.
   *
   * @param {{ requestId: string, file: { originalname: string, mimetype: string, size: number, buffer: Buffer }, actor: object }} input
   */
  async upload({ requestId, file, actor = {} }) {
    const request = await this.assertRequest(requestId);
    await this.assertCanAccessRequest(request, actor);

    if (!file || !file.buffer) {
      throw new ValidationError("A file is required.", { field: "file" });
    }

    const policy = await this.getUploadPolicy();
    validateUpload(
      {
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalName: file.originalname,
      },
      policy
    );

    const key = sanitizeStoredName(file.originalname);
    await this.storage.save({ key, buffer: file.buffer });

    const record = await this.attachmentRepository.create({
      key,
      requestId: this.id(request),
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor.actorId ?? null,
    });

    await this.recordAudit("FILE.UPLOADED", record, request, actor);

    return this.toDto(record);
  }

  /**
   * Lists attachment metadata for a request the actor may access. Internal
   * storage keys are never exposed.
   *
   * @param {{ requestId: string, actor: object }} input
   */
  async list({ requestId, actor = {} }) {
    const request = await this.assertRequest(requestId);
    await this.assertCanAccessRequest(request, actor);
    const items = await this.attachmentRepository.findByRequest(this.id(request));
    return items.map((item) => this.toDto(item));
  }

  /**
   * Downloads a file for an authorized actor.
   *
   * @param {{ attachmentId: string, actor: object }} input
   * @returns {Promise<{ buffer: Buffer, attachment: object }>}
   */
  async download({ attachmentId, actor = {} }) {
    const record = await this.attachmentRepository.findById(attachmentId);
    if (!record) throw new NotFoundError("File not found.", "ATTACHMENT_NOT_FOUND");

    const request = await this.assertRequest(record.requestId);
    await this.assertCanAccessRequest(request, actor);

    const buffer = await this.storage.read(record.key);
    await this.recordAudit("FILE.DOWNLOADED", record, request, actor);

    return { buffer, attachment: this.toDto(record) };
  }

  /**
   * Soft-deletes the record and removes the stored file.
   *
   * @param {{ attachmentId: string, actor: object }} input
   */
  async delete({ attachmentId, actor = {} }) {
    const record = await this.attachmentRepository.findById(attachmentId);
    if (!record) throw new NotFoundError("File not found.", "ATTACHMENT_NOT_FOUND");

    const request = await this.assertRequest(record.requestId);

    const isRequester = String(request.requesterId) === String(actor.actorId);
    const isAdmin =
      this.isHr(actor) || this.hasPermission(actor, "files:delete");
    if (!isRequester && !isAdmin) {
      throw new NotFoundError("File not found.", "ATTACHMENT_NOT_FOUND");
    }

    const deleted = await this.attachmentRepository.softDelete(this.id(record), {
      deletedBy: actor.actorId ?? null,
    });
    if (!deleted) throw new NotFoundError("File not found.", "ATTACHMENT_NOT_FOUND");

    await this.storage.delete(record.key);
    await this.recordAudit("FILE.DELETED", record, request, actor);

    return { deleted: true, id: this.id(record) };
  }

  /** Fetches a request; answers 404 (no existence leak) when missing. */
  async assertRequest(requestId) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
    }
    return request;
  }

  /**
   * Access control shared by upload/list/download: the requester, the assigned
   * approver, HR (role or HR-view permission), or — FR-010 — an eligible
   * approver reviewing a role-targeted, not-yet-claimed PENDING request
   * (mirrors the approval-inbox visibility rule). Denied access answers 404.
   */
  async assertCanAccessRequest(request, actor) {
    const isRequester = String(request.requesterId) === String(actor.actorId);
    const isApprover = String(request.approverId) === String(actor.actorId);
    const isAdmin =
      this.isHr(actor) ||
      this.hasPermission(actor, "users:view") ||
      this.hasPermission(actor, "attendance:view_all");
    if (isRequester || isApprover || isAdmin) return;

    // FR-010: eligible approver of a role-targeted, unclaimed PENDING request.
    if (
      request.status === "PENDING" &&
      request.approval?.targetType === "ROLE" &&
      !request.approval?.assignedUserId &&
      (await this.isEligibleApprover(request, actor))
    ) {
      return;
    }

    throw new NotFoundError("Request not found.", "REQUEST_NOT_FOUND");
  }

  /**
   * FR-010: true when the actor holds the request type's `*:approve` permission
   * AND is currently an eligible approver for the type per the approval
   * configuration. Without a wired configuration service the actor is NOT
   * eligible (fail closed).
   */
  async isEligibleApprover(request, actor) {
    const permissionKey = `${String(request.type).toLowerCase()}:approve`;
    if (!this.hasPermission(actor, permissionKey)) return false;
    if (!this.approvalConfigurationService) return false;
    const users = await this.approvalConfigurationService.getEligibleUsers(request.type);
    return users.some((u) => String(u.userId) === String(actor.actorId));
  }

  isHr(actor) {
    return (actor.actorRoleKeys ?? []).some((key) => HR_ROLES.includes(key));
  }

  hasPermission(actor, key) {
    return (actor.actorPermissions ?? []).includes(key);
  }

  /** Records a FILE.* audit event with the standard metadata shape. */
  async recordAudit(action, record, request, actor) {
    const requestId = this.id(request);
    await this.auditService.record({
      action,
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: {
        type: "ATTACHMENT",
        id: this.id(record),
        summary: record.originalName,
      },
      outcome: "SUCCESS",
      metadata: {
        requestId,
        fileName: record.originalName,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }

  /** Plain metadata DTO — internal keys never cross the boundary. */
  toDto(record) {
    return {
      id: this.id(record),
      requestId: record.requestId?.toString?.() ?? record.requestId,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      uploadedBy: record.uploadedBy?.toString?.() ?? record.uploadedBy,
      uploadedAt: record.createdAt ?? record.uploadedAt ?? null,
    };
  }

  id(doc) {
    return String(doc.id ?? doc._id);
  }

  defaultPolicy() {
    return {
      allowedTypes: [...DEFAULT_UPLOAD_POLICY.allowedTypes],
      maxSizeBytes: DEFAULT_UPLOAD_POLICY.maxSizeBytes,
    };
  }
}

module.exports = { AttachmentService };
