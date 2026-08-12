/**
 * ContractTypeService tests (NEW UPDATE TAD SIMBIKA): create/update/
 * activate/deactivate, duplicate-key conflict, isActiveType null-safety,
 * and SETTINGS.CHANGED audit.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ContractTypeService } = require("../../src/application/contract-type.service");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { ConflictError, NotFoundError, ValidationError } = require("../../src/domain/errors");

/** Minimal in-memory repository mirroring the real ContractTypeRepository. */
class InMemoryContractTypeRepository {
  constructor() {
    this.rows = new Map();
    this.nextId = 1;
  }

  async findByKey(key) {
    const upper = String(key).toUpperCase();
    for (const row of this.rows.values()) if (row.key === upper) return row;
    return null;
  }

  async findById(id) {
    return this.rows.get(String(id)) ?? null;
  }

  async getById(id) {
    const row = this.rows.get(String(id));
    if (!row) throw new NotFoundError("Contract type not found.", "CONTRACT_TYPE_NOT_FOUND");
    return row;
  }

  async create(input) {
    const id = `ct_${this.nextId++}`;
    const row = {
      id,
      key: String(input.key).toUpperCase(),
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "ACTIVE",
      updatedBy: input.updatedBy ?? null,
    };
    this.rows.set(id, row);
    return row;
  }

  async update(id, { name, description, updatedBy = null }) {
    const row = this.rows.get(String(id));
    if (!row) return null;
    if (name !== undefined) row.name = name.trim();
    if (description !== undefined) row.description = description.trim();
    row.updatedBy = updatedBy ?? null;
    return row;
  }

  async setStatus(id, status, updatedBy = null) {
    const row = this.rows.get(String(id));
    if (!row) return null;
    row.status = status;
    row.updatedBy = updatedBy ?? null;
    return row;
  }

  async list({ search, status } = {}) {
    let rows = [...this.rows.values()];
    if (status) rows = rows.filter((r) => r.status === status);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listActive() {
    return [...this.rows.values()]
      .filter((r) => r.status === "ACTIVE")
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function makeService() {
  const repository = new InMemoryContractTypeRepository();
  const auditRepository = {
    entries: [],
    async record(entry) {
      this.entries.push(entry);
      return entry;
    },
  };
  const chainVerifier = new HashChainVerifier({ auditRepository, salt: "test-salt" });
  const auditService = new AuditService({
    publisher: {
      async publish(event) {
        auditRepository.entries.push(event);
        return event;
      },
      async dispatch() {},
    },
    auditRepository,
    activityRepository: { entries: [], async record() {} },
    chainVerifier,
  });
  const service = new ContractTypeService({ contractTypeRepository: repository, auditService });
  return { service, repository, auditService, auditRepository };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

test("create validates input and persists an ACTIVE contract type", async () => {
  const { service, repository } = makeService();
  const dto = await service.create({ key: "KONTRAK_TETAP", name: "Kontrak Tetap" }, ACTOR);
  assert.equal(dto.key, "KONTRAK_TETAP");
  assert.equal(dto.status, "ACTIVE");
  assert.ok(await repository.findByKey("KONTRAK_TETAP"));
});

test("create rejects invalid key and duplicate key", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.create({ key: "lower", name: "Bad" }, ACTOR),
    (err) => err instanceof ValidationError
  );
  await service.create({ key: "DUPLICATE", name: "Duplicate" }, ACTOR);
  await assert.rejects(
    () => service.create({ key: "DUPLICATE", name: "Again" }, ACTOR),
    (err) => err instanceof ConflictError && err.code === "CONTRACT_TYPE_EXISTS"
  );
});

test("activate/deactivate flips status and inactive is hidden from active list", async () => {
  const { service, repository } = makeService();
  const created = await service.create({ key: "PROBATION", name: "Probation" }, ACTOR);
  const deactivated = await service.deactivate(created.id, ACTOR);
  assert.equal(deactivated.status, "INACTIVE");
  const active = await repository.listActive();
  assert.equal(active.length, 0);
  const reactivated = await service.activate(created.id, ACTOR);
  assert.equal(reactivated.status, "ACTIVE");
});

test("update changes name/description; unknown id -> NotFound", async () => {
  const { service } = makeService();
  const created = await service.create({ key: "OUTSOURCE", name: "Outsource" }, ACTOR);
  const updated = await service.update(created.id, { name: "Outsourcing" }, ACTOR);
  assert.equal(updated.name, "Outsourcing");
  await assert.rejects(
    () => service.update("missing", { name: "X" }, ACTOR),
    (err) => err instanceof NotFoundError
  );
});

test("isActiveType is null-safe and resolves status", async () => {
  const { service, repository } = makeService();
  const created = await service.create({ key: "PKWT", name: "PKWT" }, ACTOR);
  assert.equal(await service.isActiveType(created.id), true);
  await repository.setStatus(created.id, "INACTIVE");
  assert.equal(await service.isActiveType(created.id), false);
  assert.equal(await service.isActiveType("not-a-real-id"), false);
});

test("mutations record SETTINGS.CHANGED audit with CONTRACT_TYPE subject", async () => {
  const { service, auditRepository } = makeService();
  await service.create({ key: "HONORER", name: "Honorer" }, ACTOR);
  const event = auditRepository.entries.find((e) => e.action === "SETTINGS.CHANGED");
  assert.ok(event, "SETTINGS.CHANGED audit event recorded");
  assert.equal(event.subject.type, "CONTRACT_TYPE");
  assert.equal(event.metadata.kind, "create");
});
