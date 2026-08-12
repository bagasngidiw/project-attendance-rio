/**
 * AttachmentService tests (FR-017): upload/list/download/delete flows,
 * request-scoped access control (requester / approver / HR vs unrelated user),
 * soft-delete, audit events, and domain policy rejection.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { AttachmentService } = require("../../src/application/attachment.service");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

class InMemoryAttachmentRepository {
  constructor() {
    this.entries = new Map();
    this.nextId = 1;
  }

  async create({ key, requestId, originalName, mimeType, sizeBytes, uploadedBy }) {
    const id = `att_${this.nextId++}`;
    const doc = {
      id,
      key,
      requestId: String(requestId),
      originalName,
      mimeType,
      sizeBytes,
      uploadedBy: String(uploadedBy),
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entries.set(id, doc);
    return doc;
  }

  async findById(id, { includeDeleted = false } = {}) {
    const doc = this.entries.get(String(id));
    if (!doc) return null;
    if (!includeDeleted && doc.deletedAt) return null;
    return doc;
  }

  async findByRequest(requestId, { includeDeleted = false } = {}) {
    return [...this.entries.values()]
      .filter(
        (d) =>
          String(d.requestId) === String(requestId) &&
          (includeDeleted || !d.deletedAt)
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async softDelete(id, { deletedBy = null } = {}) {
    const doc = this.entries.get(String(id));
    if (!doc || doc.deletedAt) return null;
    doc.deletedAt = new Date();
    doc.deletedBy = String(deletedBy);
    return doc;
  }
}

class InMemoryStorage {
  constructor() {
    this.files = new Map();
  }

  async save({ key, buffer }) {
    this.files.set(key, buffer);
    return key;
  }

  async read(key) {
    return this.files.get(key) ?? null;
  }

  async delete(key) {
    this.files.delete(key);
  }

  async exists(key) {
    return this.files.has(key);
  }
}

function makeService() {
  const fakes = buildFakes();
  const chainVerifier = new HashChainVerifier({
    auditRepository: fakes.auditRepository,
    salt: "test-salt",
  });
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier,
  });
  const storage = new InMemoryStorage();
  const service = new AttachmentService({
    attachmentRepository: new InMemoryAttachmentRepository(),
    requestRepository: fakes.requestRepository,
    userRepository: fakes.userRepository,
    storage,
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
  });
  return { service, fakes, storage };
}

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Emp", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_hr", username: "hr", email: "hr@corp.io", name: "HR", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_stranger", username: "stranger", email: "stranger@corp.io", name: "Stranger", status: "ACTIVE" });
}

async function seedRequest(fakes, { requesterId = "u_emp", approverId = "u_mgr" } = {}) {
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId,
    payload: {},
    status: "PENDING",
  });
  request.approverId = approverId;
  return request;
}

function actor(overrides = {}) {
  return {
    actorId: "u_emp",
    actorRoleKeys: [],
    actorPermissions: [],
    ip: "127.0.0.1",
    userAgent: "node-test",
    correlationId: "corr_test",
    ...overrides,
  };
}

function file(overrides = {}) {
  return {
    originalname: "receipt.pdf",
    mimetype: "application/pdf",
    size: 1024,
    buffer: Buffer.from("fake-pdf-bytes"),
    ...overrides,
  };
}

function auditEntries(fakes, action) {
  return fakes.auditRepository.entries.filter((e) => e.action === action);
}

/* ------------------------------- policy ------------------------------- */

test("attachment service getUploadPolicy falls back to defaults", async () => {
  const { service } = makeService();
  const policy = await service.getUploadPolicy();
  assert.deepEqual([...policy.allowedTypes].sort(), [
    "application/pdf",
    "image/jpeg",
    "image/png",
  ]);
  assert.equal(policy.maxSizeBytes, 5 * 1024 * 1024);
});

test("attachment service getUploadPolicy honors the stored platform setting", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("fileUpload", {
    allowedTypes: ["text/csv"],
    maxSizeBytes: 2048,
  });
  const policy = await service.getUploadPolicy();
  assert.deepEqual(policy.allowedTypes, ["text/csv"]);
  assert.equal(policy.maxSizeBytes, 2048);
});

/* ------------------------------- upload ------------------------------- */

test("attachment upload: requester stores the file, records metadata, and audits FILE.UPLOADED", async () => {
  const { service, fakes, storage } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  const result = await service.upload({
    requestId: request.id,
    file: file(),
    actor: actor(),
  });

  assert.equal(result.requestId, request.id);
  assert.equal(result.originalName, "receipt.pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.sizeBytes, 1024);
  assert.equal(result.uploadedBy, "u_emp");
  assert.ok(result.id);
  assert.ok(result.uploadedAt);
  assert.equal("key" in result, false, "internal storage key never leaks");

  assert.equal(storage.files.size, 1, "bytes persisted to storage");

  const audit = auditEntries(fakes, "FILE.UPLOADED");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor.userId, "u_emp");
  assert.equal(audit[0].metadata.requestId, request.id);
  assert.equal(audit[0].metadata.fileName, "receipt.pdf");
  assert.equal(audit[0].metadata.sizeBytes, 1024);
  assert.equal(audit[0].metadata.mimeType, "application/pdf");
});

test("attachment upload: assigned approver can upload", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  const result = await service.upload({
    requestId: request.id,
    file: file(),
    actor: actor({ actorId: "u_mgr" }),
  });
  assert.equal(result.uploadedBy, "u_mgr");
});

test("attachment upload: HR_ADMIN role can upload", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  const result = await service.upload({
    requestId: request.id,
    file: file(),
    actor: actor({ actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] }),
  });
  assert.equal(result.uploadedBy, "u_hr");
});

test("attachment upload: users:view permission grants HR-level access", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  const result = await service.upload({
    requestId: request.id,
    file: file(),
    actor: actor({ actorId: "u_stranger", actorPermissions: ["users:view"] }),
  });
  assert.equal(result.uploadedBy, "u_stranger");
});

test("attachment upload: unrelated user is denied with NotFoundError (no existence leak)", async () => {
  const { service, fakes, storage } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  await assert.rejects(
    service.upload({ requestId: request.id, file: file(), actor: actor({ actorId: "u_stranger" }) }),
    (err) => err instanceof NotFoundError && err.code === "REQUEST_NOT_FOUND"
  );
  assert.equal(storage.files.size, 0, "nothing stored for a denied upload");
  assert.equal(auditEntries(fakes, "FILE.UPLOADED").length, 0);
});

test("attachment upload: unknown request throws NotFoundError", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);

  await assert.rejects(
    service.upload({ requestId: "req_missing", file: file(), actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "REQUEST_NOT_FOUND"
  );
});

test("attachment upload: missing file is rejected", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  await assert.rejects(
    service.upload({ requestId: request.id, file: undefined, actor: actor() }),
    (err) => err instanceof ValidationError && err.details.field === "file"
  );
});

test("attachment upload: oversized file is rejected via the domain policy", async () => {
  const { service, fakes, storage } = makeService();
  seedUsers(fakes);
  await fakes.platformSettingRepository.set("fileUpload", {
    allowedTypes: ["application/pdf"],
    maxSizeBytes: 512,
  });
  const request = await seedRequest(fakes);

  await assert.rejects(
    service.upload({ requestId: request.id, file: file({ size: 1024 }), actor: actor() }),
    (err) => err instanceof ValidationError && err.details.field === "sizeBytes"
  );
  assert.equal(storage.files.size, 0);
  assert.equal(auditEntries(fakes, "FILE.UPLOADED").length, 0);
});

test("attachment upload: disallowed mime type is rejected", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  await assert.rejects(
    service.upload({ requestId: request.id, file: file({ mimetype: "text/html" }), actor: actor() }),
    (err) => err instanceof ValidationError && err.details.field === "mimeType"
  );
});

test("attachment upload: path-traversal file name is rejected", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);

  await assert.rejects(
    service.upload({ requestId: request.id, file: file({ originalname: "../evil.pdf" }), actor: actor() }),
    (err) => err instanceof ValidationError && err.details.field === "originalName"
  );
});

/* -------------------------------- list -------------------------------- */

test("attachment list: requester sees metadata (no internal keys)", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  await service.upload({ requestId: request.id, file: file({ originalname: "a.pdf" }), actor: actor() });
  await service.upload({ requestId: request.id, file: file({ originalname: "b.png", mimetype: "image/png" }), actor: actor() });

  const items = await service.list({ requestId: request.id, actor: actor() });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.id && i.requestId && i.originalName && i.uploadedAt));
  assert.ok(items.every((i) => !("key" in i)), "storage keys never leak");
  assert.ok(items.some((i) => i.originalName === "a.pdf"));
  assert.ok(items.some((i) => i.originalName === "b.png"));
});

test("attachment list: unrelated user is denied", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  await service.upload({ requestId: request.id, file: file(), actor: actor() });

  await assert.rejects(
    service.list({ requestId: request.id, actor: actor({ actorId: "u_stranger" }) }),
    (err) => err instanceof NotFoundError && err.code === "REQUEST_NOT_FOUND"
  );
});

test("attachment list: unknown request throws NotFoundError", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.list({ requestId: "req_missing", actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "REQUEST_NOT_FOUND"
  );
});

/* ------------------------------ download ------------------------------ */

test("attachment download: requester receives the buffer and FILE.DOWNLOADED is audited", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  const { buffer, attachment } = await service.download({
    attachmentId: uploaded.id,
    actor: actor(),
  });
  assert.deepEqual(buffer, Buffer.from("fake-pdf-bytes"));
  assert.equal(attachment.originalName, "receipt.pdf");

  const audit = auditEntries(fakes, "FILE.DOWNLOADED");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].metadata.requestId, request.id);
  assert.equal(audit[0].metadata.fileName, "receipt.pdf");
});

test("attachment download: assigned approver and HR can download", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  const asApprover = await service.download({
    attachmentId: uploaded.id,
    actor: actor({ actorId: "u_mgr" }),
  });
  assert.deepEqual(asApprover.buffer, Buffer.from("fake-pdf-bytes"));

  const asHr = await service.download({
    attachmentId: uploaded.id,
    actor: actor({ actorId: "u_hr", actorRoleKeys: ["SUPER_ADMIN"] }),
  });
  assert.deepEqual(asHr.buffer, Buffer.from("fake-pdf-bytes"));
});

test("attachment download: unrelated user is denied", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  await assert.rejects(
    service.download({ attachmentId: uploaded.id, actor: actor({ actorId: "u_stranger" }) }),
    (err) => err instanceof NotFoundError
  );
});

test("attachment download: missing attachment throws NotFoundError", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.download({ attachmentId: "att_unknown", actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "ATTACHMENT_NOT_FOUND"
  );
});

test("attachment download: soft-deleted file is a 404", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  await service.delete({ attachmentId: uploaded.id, actor: actor() });
  await assert.rejects(
    service.download({ attachmentId: uploaded.id, actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "ATTACHMENT_NOT_FOUND"
  );
});

/* ------------------------------- delete ------------------------------- */

test("attachment delete: requester soft-deletes the record, purges storage, and audits FILE.DELETED", async () => {
  const { service, fakes, storage } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });
  assert.equal(storage.files.size, 1);

  const result = await service.delete({ attachmentId: uploaded.id, actor: actor() });
  assert.equal(result.deleted, true);
  assert.equal(result.id, uploaded.id);

  assert.equal(storage.files.size, 0, "stored file purged from storage");

  const audit = auditEntries(fakes, "FILE.DELETED");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].metadata.requestId, request.id);
  assert.equal(audit[0].metadata.fileName, "receipt.pdf");
});

test("attachment delete: HR_ADMIN can delete", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  const result = await service.delete({
    attachmentId: uploaded.id,
    actor: actor({ actorId: "u_hr", actorRoleKeys: ["HR_ADMIN"] }),
  });
  assert.equal(result.deleted, true);
});

test("attachment delete: files:delete permission (non-requester, non-HR) can delete", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  const result = await service.delete({
    attachmentId: uploaded.id,
    actor: actor({ actorId: "u_stranger", actorPermissions: ["files:delete"] }),
  });
  assert.equal(result.deleted, true);
});

test("attachment delete: unrelated user without files:delete is denied", async () => {
  const { service, fakes, storage } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  await assert.rejects(
    service.delete({ attachmentId: uploaded.id, actor: actor({ actorId: "u_stranger" }) }),
    (err) => err instanceof NotFoundError
  );
  assert.equal(storage.files.size, 1, "file untouched on a denied delete");
  assert.equal(auditEntries(fakes, "FILE.DELETED").length, 0);
});

test("attachment delete: missing attachment throws NotFoundError", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.delete({ attachmentId: "att_unknown", actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "ATTACHMENT_NOT_FOUND"
  );
});

test("attachment delete: deleting an already soft-deleted file is a 404", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const request = await seedRequest(fakes);
  const uploaded = await service.upload({ requestId: request.id, file: file(), actor: actor() });

  await service.delete({ attachmentId: uploaded.id, actor: actor() });
  await assert.rejects(
    service.delete({ attachmentId: uploaded.id, actor: actor() }),
    (err) => err instanceof NotFoundError && err.code === "ATTACHMENT_NOT_FOUND"
  );
});
