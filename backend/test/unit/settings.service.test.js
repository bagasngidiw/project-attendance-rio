/**
 * SettingsService tests (FR-032): schema-validated reads/writes with audit.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { HashChainVerifier } = require("../../src/infrastructure/hash-chain-verifier");
const { SettingsService } = require("../../src/application/settings.service");
const { ValidationError } = require("../../src/domain/errors");

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
  const service = new SettingsService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
  });
  return { service, fakes };
}

const ACTOR = { actorId: "u_admin", actorRoleKeys: ["SUPER_ADMIN"] };

test("getSettings returns every catalog key (null when unset)", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("sessionInactivityMs", 60000);

  const settings = await service.getSettings();
  assert.equal(settings.sessionInactivityMs, 60000);
  assert.equal(settings.maxFailedAttempts, null);
  assert.ok("moduleEnablement" in settings);
  assert.ok("companyTimezoneOffsetMs" in settings);
});

test("updateSetting validates the value type and range (B4)", async () => {
  const { service } = makeService();

  await assert.rejects(
    service.updateSetting("sessionInactivityMs", "60000", ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "sessionInactivityMs"
  );
  await assert.rejects(
    service.updateSetting("maxFailedAttempts", 0, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "maxFailedAttempts"
  );
  await assert.rejects(
    service.updateSetting("rejectionReasonRequired", "yes", ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "rejectionReasonRequired"
  );
  await assert.rejects(
    service.updateSetting("unknownKey", 1, ACTOR),
    (err) => err instanceof ValidationError && err.details.field === "key"
  );
});

test("updateSetting persists and audits with old + new value (B4)", async () => {
  const { service, fakes } = makeService();
  await fakes.platformSettingRepository.set("maxFailedAttempts", 5);

  const result = await service.updateSetting("maxFailedAttempts", 7, ACTOR);
  assert.equal(result.value, 7);
  assert.equal(await fakes.platformSettingRepository.get("maxFailedAttempts"), 7);

  const audit = fakes.auditRepository.entries.find((e) => e.action === "SETTINGS.CHANGED");
  assert.ok(audit, "SETTINGS.CHANGED recorded");
  assert.equal(audit.metadata.setting, "maxFailedAttempts");
  assert.equal(audit.metadata.oldValue, 5);
  assert.equal(audit.metadata.newValue, 7);
});

test("object-typed settings accept maps (moduleEnablement)", async () => {
  const { service } = makeService();
  const result = await service.updateSetting(
    "moduleEnablement",
    { leave: true, overtime: true },
    ACTOR
  );
  assert.deepEqual(result.value, { leave: true, overtime: true });
});
