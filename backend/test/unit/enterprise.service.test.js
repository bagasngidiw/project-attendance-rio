/**
 * EnterpriseService tests (FR-039): get/set of the enterprise configuration
 * block with normalization and SETTINGS.CHANGED audit.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { EnterpriseService } = require("../../src/application/enterprise.service");

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
  const service = new EnterpriseService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
  });
  return { service, fakes };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

test("getEnterpriseConfig returns the default skeleton when unset", async () => {
  const { service } = makeService();
  const config = await service.getEnterpriseConfig();
  assert.deepEqual(config.brand, { companyName: "", logoUrl: "" });
  assert.equal(config.timezone, "UTC");
  assert.deepEqual(config.defaults, {});
});

test("getEnterpriseConfig returns the stored config", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("enterprise", {
    brand: { companyName: "Acme" },
    timezone: "Asia/Tokyo",
  });
  const config = await service.getEnterpriseConfig();
  assert.equal(config.brand.companyName, "Acme");
  assert.equal(config.timezone, "Asia/Tokyo");
  assert.deepEqual(config.defaults, {});
});

test("setEnterpriseConfig persists and audits SETTINGS.CHANGED", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("enterprise", {
    brand: { companyName: "Old" },
  });

  const result = await service.setEnterpriseConfig(
    {
      brand: { companyName: "Acme", logoUrl: "https://x/logo.png" },
      timezone: "UTC",
    },
    ACTOR
  );

  assert.equal(result.key, "enterprise");
  assert.equal(result.value.brand.companyName, "Acme");
  assert.equal(result.value.brand.logoUrl, "https://x/logo.png");
  assert.equal(
    (await fakes.platformSettingRepository.get("enterprise")).brand.companyName,
    "Acme"
  );

  const audit = fakes.auditRepository.entries.find((e) => e.action === "SETTINGS.CHANGED");
  assert.ok(audit, "SETTINGS.CHANGED recorded");
  assert.equal(audit.actor.userId, "u_admin");
  assert.equal(audit.subject.id, "enterprise");
  assert.equal(audit.metadata.setting, "enterprise");
  assert.equal(audit.metadata.oldValue.brand.companyName, "Old");
  assert.equal(audit.metadata.newValue.brand.companyName, "Acme");
});

test("setEnterpriseConfig normalizes partial/invalid input over the skeleton", async () => {
  const { service } = makeService();
  const result = await service.setEnterpriseConfig({ brand: { logoUrl: 42 } }, ACTOR);
  assert.equal(result.value.brand.companyName, "");
  assert.equal(result.value.brand.logoUrl, "");
  assert.equal(result.value.timezone, "UTC");
  assert.deepEqual(result.value.defaults, {});
});

test("setEnterpriseConfig preserves defaults when provided", async () => {
  const { service } = makeService();
  const result = await service.setEnterpriseConfig(
    { defaults: { workingDays: ["MON", "FRI"] } },
    ACTOR
  );
  assert.deepEqual(result.value.defaults, { workingDays: ["MON", "FRI"] });
  assert.equal(result.value.timezone, "UTC");
});
