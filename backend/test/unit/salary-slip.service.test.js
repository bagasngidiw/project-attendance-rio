/**
 * SalarySlipService tests (FR-006): upload (receiver ACTIVE + sender
 * `salary:manage` + file policy), in-app notification event, owner-scoped
 * listing with sender names, and download authorization (receiver / manager;
 * others get 404). `storageKey` never appears in any DTO.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { SalarySlipService } = require("../../src/application/salary-slip.service");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

class InMemorySalarySlipRepository {
  constructor() {
    this.entries = new Map();
    this.nextId = 1;
  }

  async create({ userId, senderId, payDate, periodLabel, notes, fileName, mimeType, sizeBytes, storageKey }) {
    const id = `slip_${this.nextId++}`;
    const doc = {
      id,
      userId: String(userId),
      senderId: String(senderId),
      payDate,
      periodLabel,
      notes: notes ?? "",
      fileName,
      mimeType,
      sizeBytes,
      storageKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entries.set(id, doc);
    return doc;
  }

  async findById(id) {
    return this.entries.get(String(id)) ?? null;
  }

  async listByUser(userId, { page = 1, pageSize = 20 } = {}) {
    const items = [...this.entries.values()]
      .filter((d) => String(d.userId) === String(userId))
      .sort((a, b) => new Date(b.payDate) - new Date(a.payDate));
    const total = items.length;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total };
  }

  async listAll({ page = 1, pageSize = 20 } = {}) {
    const items = [...this.entries.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const total = items.length;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total };
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
  const eventBus = new EventBus();
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
  const repository = new InMemorySalarySlipRepository();
  const storage = new InMemoryStorage();
  const service = new SalarySlipService({
    salarySlipRepository: repository,
    userRepository: fakes.userRepository,
    storage,
    auditService,
    eventBus,
  });
  return { service, fakes, eventBus, repository, storage, auditService };
}

function seedUsers(fakes) {
  fakes.userRepository.seed({ id: "u_super", username: "super", name: "Super Admin", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_emp", username: "emp", name: "Jane", status: "ACTIVE" });
  fakes.userRepository.seed({ id: "u_inactive", username: "inactive", name: "Gone", status: "INACTIVE" });
  fakes.userRepository.seed({ id: "u_other", username: "other", name: "Other", status: "ACTIVE" });
}

const SUPER_ACTOR = {
  actorId: "u_super",
  actorRoleKeys: ["SUPER_ADMIN"],
  actorPermissions: ["salary:manage", "salary:view_own"],
};
const EMPLOYEE_ACTOR = {
  actorId: "u_emp",
  actorRoleKeys: ["PENGEMUDI"],
  actorPermissions: ["salary:view_own"],
};

function pdfFile(overrides = {}) {
  return {
    originalname: "slip-juli-2026.pdf",
    mimetype: "application/pdf",
    size: 2048,
    buffer: Buffer.from("%PDF-1.4 fake"),
    ...overrides,
  };
}

test("FR-006: upload persists metadata, stores bytes, audits, and publishes an event", async () => {
  const { service, fakes, eventBus, repository, storage, auditService } = makeService();
  seedUsers(fakes);
  const events = [];
  eventBus.subscribe("salary.slip_uploaded", (payload) => events.push(payload));

  const dto = await service.upload({
    userId: "u_emp",
    file: pdfFile(),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-07-31T00:00:00Z"),
    periodLabel: "Juli 2026",
    notes: "Gaji pokok",
  });

  assert.equal(dto.userId, "u_emp");
  assert.equal(dto.senderId, "u_super");
  assert.equal(dto.senderName, "Super Admin");
  assert.equal(dto.periodLabel, "Juli 2026");
  assert.equal(dto.notes, "Gaji pokok");
  assert.equal(dto.fileName, "slip-juli-2026.pdf");
  assert.equal(dto.mimeType, "application/pdf");
  assert.equal(dto.sizeBytes, 2048);
  assert.ok(!("storageKey" in dto), "storageKey never exposed");
  assert.ok(!JSON.stringify(dto).includes("storageKey"), "storageKey absent from serialized DTO");

  assert.equal(repository.entries.size, 1, "metadata row created");
  assert.equal(storage.files.size, 1, "file bytes stored");
  assert.ok([...storage.files.keys()][0].startsWith("slip-"), "random opaque storage key");

  assert.ok(
    auditService.auditRepository.entries.some((e) => e.action === "SALARY.UPLOADED"),
    "SALARY.UPLOADED audited"
  );
  assert.equal(events.length, 1, "salary.slip_uploaded published");
  assert.equal(events[0].userId, "u_emp");
  assert.equal(events[0].periodLabel, "Juli 2026");
});

test("FR-006: upload rejects an INACTIVE receiver", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.upload({
      userId: "u_inactive",
      file: pdfFile(),
      sender: SUPER_ACTOR,
      payDate: new Date("2026-07-31T00:00:00Z"),
      periodLabel: "Juli 2026",
    }),
    (err) => err instanceof ValidationError
  );
});

test("FR-006: upload rejects a sender without salary:manage", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.upload({
      userId: "u_emp",
      file: pdfFile(),
      sender: EMPLOYEE_ACTOR,
      payDate: new Date("2026-07-31T00:00:00Z"),
      periodLabel: "Juli 2026",
    }),
    (err) => err instanceof ValidationError
  );
});

test("FR-006: upload rejects a disallowed file type", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await assert.rejects(
    service.upload({
      userId: "u_emp",
      file: pdfFile({ mimetype: "text/html" }),
      sender: SUPER_ACTOR,
      payDate: new Date("2026-07-31T00:00:00Z"),
      periodLabel: "Juli 2026",
    }),
    (err) => err instanceof ValidationError
  );
});

test("FR-006: listMine returns only the caller's slips with sender names", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await service.upload({
    userId: "u_emp",
    file: pdfFile(),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-07-31T00:00:00Z"),
    periodLabel: "Juli 2026",
  });
  await service.upload({
    userId: "u_other",
    file: pdfFile({ originalname: "slip-lain.pdf" }),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-06-30T00:00:00Z"),
    periodLabel: "Juni 2026",
  });

  const mine = await service.listMine({ userId: "u_emp" });
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].periodLabel, "Juli 2026");
  assert.equal(mine.items[0].senderName, "Super Admin");
});

test("FR-006: download is allowed for the receiver and for salary:manage holders; others 404", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  const dto = await service.upload({
    userId: "u_emp",
    file: pdfFile(),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-07-31T00:00:00Z"),
    periodLabel: "Juli 2026",
  });

  // Receiver can download.
  const receiver = await service.download({ slipId: dto.id, actor: EMPLOYEE_ACTOR });
  assert.ok(receiver.buffer.length > 0);

  // Manager (salary:manage) can download any slip.
  const manager = await service.download({ slipId: dto.id, actor: SUPER_ACTOR });
  assert.ok(manager.buffer.length > 0);

  // Unrelated user -> 404 (no existence leak).
  await assert.rejects(
    service.download({ slipId: dto.id, actor: { actorId: "u_other", actorRoleKeys: [], actorPermissions: [] } }),
    (err) => err instanceof NotFoundError && err.code === "SALARY_SLIP_NOT_FOUND"
  );
});

test("FR-006: listAll returns every slip with sender + receiver names", async () => {
  const { service, fakes } = makeService();
  seedUsers(fakes);
  await service.upload({
    userId: "u_emp",
    file: pdfFile(),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-07-31T00:00:00Z"),
    periodLabel: "Juli 2026",
  });
  await service.upload({
    userId: "u_other",
    file: pdfFile({ originalname: "slip-lain.pdf" }),
    sender: SUPER_ACTOR,
    payDate: new Date("2026-06-30T00:00:00Z"),
    periodLabel: "Juni 2026",
  });

  const all = await service.listAll({ page: 1, pageSize: 20 });
  assert.equal(all.total, 2);
  assert.ok(all.items.every((i) => i.senderName === "Super Admin"), "sender names resolved");
  assert.ok(all.items.some((i) => i.receiverName === "Jane"), "receiver names resolved");
});