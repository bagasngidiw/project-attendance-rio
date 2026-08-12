/**
 * FilterPresetService tests (FR-047): owner scoping on every surface, audit
 * events, domain validation, pagination, and preset re-apply.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { FilterPresetService } = require("../../src/application/filter-preset.service");
const {
  validateFilterPreset,
  FILTER_PRESET_ROUTES,
  MAX_FILTERS_BYTES,
} = require("../../src/domain/filter-preset");
const { ValidationError, NotFoundError } = require("../../src/domain/errors");

/** In-memory FilterPresetRepository mirroring the Mongoose-backed contract. */
class InMemoryFilterPresetRepository {
  constructor() {
    this.store = new Map();
    this.nextId = 1;
  }

  async create({ ownerId, name, route, filters }) {
    const now = new Date();
    const doc = {
      id: `fp_${this.nextId++}`,
      ownerId: String(ownerId),
      name,
      route,
      filters,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(doc.id, doc);
    return doc;
  }

  async findByIdScoped(id, ownerId) {
    const doc = this.store.get(id);
    if (!doc || String(doc.ownerId) !== String(ownerId)) return null;
    return { ...doc, filters: doc.filters };
  }

  async listByOwner(ownerId, { route, page = 1, pageSize = 20 } = {}) {
    let items = [...this.store.values()].filter(
      (d) => String(d.ownerId) === String(ownerId)
    );
    if (route) items = items.filter((d) => d.route === route);
    // Newest first with a stable id tiebreaker (mirrors the Mongo repo sort).
    items.sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt) ||
        String(b.id).localeCompare(String(a.id))
    );
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize).map((d) => ({ ...d }));
    return { items, total };
  }

  async update(id, ownerId, patch) {
    const doc = this.store.get(id);
    if (!doc || String(doc.ownerId) !== String(ownerId)) return null;
    const updated = { ...doc, ...patch, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id, ownerId) {
    const doc = this.store.get(id);
    if (!doc || String(doc.ownerId) !== String(ownerId)) return null;
    this.store.delete(id);
    return doc;
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
  const filterPresetRepository = new InMemoryFilterPresetRepository();
  const service = new FilterPresetService({ filterPresetRepository, auditService });
  return { service, filterPresetRepository, auditRepository: fakes.auditRepository };
}

const ACTOR = {
  actorId: "u_owner",
  actorRoleKeys: ["EMPLOYEE"],
  correlationId: "corr_1",
  ip: "127.0.0.1",
  userAgent: "unit-test",
};

const INPUT = {
  name: "Pending overtime",
  route: "overtime",
  filters: { status: "PENDING", type: "OVERTIME" },
};

test("filter-preset createPreset persists and audits FILTER_PRESET.CREATED", async () => {
  const { service, filterPresetRepository, auditRepository } = makeService();

  const result = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });
  assert.equal(result.name, INPUT.name);
  assert.equal(result.route, INPUT.route);
  assert.deepEqual(result.filters, INPUT.filters);

  const stored = await filterPresetRepository.findByIdScoped(result.id, "u_owner");
  assert.ok(stored, "preset persisted");

  const audit = auditRepository.entries.find((e) => e.action === "FILTER_PRESET.CREATED");
  assert.ok(audit, "FILTER_PRESET.CREATED recorded");
  assert.equal(audit.actor.userId, "u_owner");
  assert.equal(audit.metadata.name, INPUT.name);
  assert.equal(audit.metadata.route, INPUT.route);
});

test("filter-preset createPreset validates name/route/filters (field + range)", async () => {
  const { service } = makeService();

  await assert.rejects(
    service.createPreset({ ownerId: "u_owner", input: { ...INPUT, name: "   " }, actor: ACTOR }),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  await assert.rejects(
    service.createPreset({ ownerId: "u_owner", input: { ...INPUT, name: "x".repeat(101) }, actor: ACTOR }),
    (err) => err instanceof ValidationError && err.details.field === "name"
  );
  await assert.rejects(
    service.createPreset({ ownerId: "u_owner", input: { ...INPUT, route: "not-a-route" }, actor: ACTOR }),
    (err) => err instanceof ValidationError && err.details.field === "route"
  );
  await assert.rejects(
    service.createPreset({ ownerId: "u_owner", input: { ...INPUT, filters: "nope" }, actor: ACTOR }),
    (err) => err instanceof ValidationError && err.details.field === "filters"
  );
});

test("filter-preset createPreset rejects filters over the 64 KB JSON limit", async () => {
  const { service } = makeService();
  const huge = { q: "x".repeat(MAX_FILTERS_BYTES + 1) };
  await assert.rejects(
    service.createPreset({ ownerId: "u_owner", input: { ...INPUT, filters: huge }, actor: ACTOR }),
    (err) => err instanceof ValidationError && err.details.field === "filters"
  );
});

test("filter-preset validateFilterPreset is pure and accepts a payload at the 64 KB boundary", () => {
  const atLimit = { q: "x".repeat(MAX_FILTERS_BYTES - 64) };
  const normalized = validateFilterPreset({ name: " ok ", route: "reports", filters: atLimit });
  assert.equal(normalized.name, "ok");
  assert.equal(normalized.route, "reports");
  assert.deepEqual(FILTER_PRESET_ROUTES, ["reports", "attendance", "users", "requests", "overtime", "audit"]);
});

test("filter-preset listPresets is owner-scoped, route-filtered, and paginated", async () => {
  const { service } = makeService();
  for (let i = 0; i < 3; i += 1) {
    await service.createPreset({
      ownerId: "u_owner",
      input: { ...INPUT, name: `mine ${i}`, filters: { i } },
      actor: ACTOR,
    });
  }
  await service.createPreset({
    ownerId: "u_owner",
    input: { name: "att", route: "attendance", filters: { d: 1 } },
    actor: ACTOR,
  });
  await service.createPreset({
    ownerId: "u_other",
    input: { name: "not mine", route: "overtime", filters: { d: 2 } },
    actor: ACTOR,
  });

  const page1 = await service.listPresets("u_owner", { route: "overtime", page: 1, pageSize: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.items.length, 2);
  assert.ok(page1.items.every((p) => p.route === "overtime"));
  assert.ok(page1.items.every((p) => p.ownerId === "u_owner"));

  const page2 = await service.listPresets("u_owner", { route: "overtime", page: 2, pageSize: 2 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].name, "mine 0");
});

test("filter-preset ownership: another user cannot see a preset", async () => {
  const { service } = makeService();
  const created = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });

  await assert.rejects(
    service.getByIdScoped(created.id, "u_other"),
    (err) => err instanceof NotFoundError && err.code === "FILTER_PRESET_NOT_FOUND"
  );
  await assert.rejects(
    service.rerunPreset(created.id, "u_other"),
    (err) => err instanceof NotFoundError
  );
  const list = await service.listPresets("u_other");
  assert.equal(list.total, 0);
});

test("filter-preset ownership: another user cannot update or delete a preset", async () => {
  const { service, filterPresetRepository } = makeService();
  const created = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });

  await assert.rejects(
    service.updatePreset({ id: created.id, ownerId: "u_other", patch: { name: "hijack" }, actor: ACTOR }),
    (err) => err instanceof NotFoundError
  );
  await assert.rejects(
    service.deletePreset({ id: created.id, ownerId: "u_other", actor: ACTOR }),
    (err) => err instanceof NotFoundError
  );

  const intact = await filterPresetRepository.findByIdScoped(created.id, "u_owner");
  assert.equal(intact.name, INPUT.name);
});

test("filter-preset updatePreset re-validates the merged result and audits", async () => {
  const { service, auditRepository } = makeService();
  const created = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });

  const updated = await service.updatePreset({
    id: created.id,
    ownerId: "u_owner",
    patch: { name: "Renamed", filters: { status: "APPROVED" } },
    actor: ACTOR,
  });
  assert.equal(updated.name, "Renamed");
  assert.deepEqual(updated.filters, { status: "APPROVED" });
  assert.equal(updated.route, INPUT.route, "unchanged fields preserved");

  const audit = auditRepository.entries.find((e) => e.action === "FILTER_PRESET.UPDATED");
  assert.ok(audit);
  assert.equal(audit.metadata.name, "Renamed");
  assert.equal(audit.metadata.route, INPUT.route);

  await assert.rejects(
    service.updatePreset({
      id: created.id,
      ownerId: "u_owner",
      patch: { route: "bogus" },
      actor: ACTOR,
    }),
    (err) => err instanceof ValidationError && err.details.field === "route"
  );
});

test("filter-preset deletePreset removes and audits; second delete is a 404", async () => {
  const { service, filterPresetRepository, auditRepository } = makeService();
  const created = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });

  const removed = await service.deletePreset({ id: created.id, ownerId: "u_owner", actor: ACTOR });
  assert.equal(removed.id, created.id);

  const audit = auditRepository.entries.find((e) => e.action === "FILTER_PRESET.DELETED");
  assert.ok(audit);
  assert.equal(audit.metadata.name, INPUT.name);
  assert.equal(audit.metadata.route, INPUT.route);

  assert.equal(await filterPresetRepository.findByIdScoped(created.id, "u_owner"), null);
  await assert.rejects(
    service.deletePreset({ id: created.id, ownerId: "u_owner", actor: ACTOR }),
    (err) => err instanceof NotFoundError
  );
});

test("filter-preset rerunPreset returns the stored filters to re-apply", async () => {
  const { service } = makeService();
  const created = await service.createPreset({ ownerId: "u_owner", input: INPUT, actor: ACTOR });

  const rerun = await service.rerunPreset(created.id, "u_owner");
  assert.equal(rerun.route, INPUT.route);
  assert.deepEqual(rerun.filters, INPUT.filters);

  const stored = await service.getByIdScoped(created.id, "u_owner");
  assert.deepEqual(stored.filters, INPUT.filters, "re-running does not mutate the stored copy");
});
