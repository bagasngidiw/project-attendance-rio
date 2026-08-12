/**
 * Branding service tests (FR-001/FR-002/FR-003): get defaults, update + audit,
 * logo upload/remove validation, SVG sanitization path.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { AuditService } = require("../../src/application/audit.service");
const { BrandingService, BRANDING_KEY } = require("../../src/application/branding.service");
const { sanitizeSvg } = require("../../src/infrastructure/svg-sanitizer");
const { ValidationError } = require("../../src/domain/errors");

/** In-memory logo storage. */
class InMemoryStorage {
  constructor() {
    this.files = new Map();
  }
  async save({ key, buffer }) {
    this.files.set(key, buffer);
    return key;
  }
  async read(key) {
    if (!this.files.has(key)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return this.files.get(key);
  }
  async delete(key) {
    this.files.delete(key);
  }
  async exists(key) {
    return this.files.has(key);
  }
}

let fakes;
let service;
let storage;

beforeEach(() => {
  fakes = buildFakes();
  storage = new InMemoryStorage();
  const auditService = new AuditService({
    publisher: fakes.publisher,
    auditRepository: fakes.auditRepository,
    activityRepository: fakes.activityRepository,
    chainVerifier: { verify: async () => ({ valid: true, firstBrokenIndex: null, count: 0 }) },
  });
  service = new BrandingService({
    platformSettingRepository: fakes.platformSettingRepository,
    auditService,
    logoStorage: storage,
  });
});

const ACTOR = { actorId: "u_1", actorRoleKeys: ["SUPER_ADMIN"], correlationId: "corr_x" };

test("getBranding returns identity defaults when never configured", async () => {
  const branding = await service.getBranding();
  assert.equal(branding.applicationName, "Sistem Informasi Sumber Daya Manusia");
  assert.equal(branding.applicationShortName, "HRIS");
  assert.equal(branding.logo, null);
  assert.equal(branding.tokens["--brand-primary"], "#D90429", "fixed product token");
});

test("updateBranding persists identity and audits SETTINGS.CHANGED with changed fields", async () => {
  const result = await service.updateBranding(
    { applicationName: "HR Baru", applicationShortName: "HRB", colors: { primary: "#123456" } },
    ACTOR
  );
  assert.equal(result.applicationName, "HR Baru");
  assert.equal(result.applicationShortName, "HRB");
  assert.equal(result.colors, undefined, "colors are not part of the response");
  assert.equal(result.tokens["--brand-primary"], "#D90429", "tokens stay fixed");

  const stored = await fakes.platformSettingRepository.get(BRANDING_KEY);
  assert.equal(stored.applicationName, "HR Baru");
  assert.equal(stored.colors, undefined, "legacy colors are not persisted from input");

  const audit = fakes.auditRepository.entries.find((e) => e.action === "SETTINGS.CHANGED");
  assert.ok(audit, "SETTINGS.CHANGED recorded");
  assert.ok(audit.metadata.changedFields.includes("applicationName"));
  assert.ok(!audit.metadata.changedFields.includes("colors"));
});

test("updateBranding rejects invalid names (colors are ignored)", async () => {
  await assert.rejects(
    service.updateBranding({ applicationName: "", applicationShortName: "X" }, ACTOR),
    ValidationError
  );
  // Colors in the payload are ignored — not validated, not rejected.
  const ok = await service.updateBranding(
    { applicationName: "X", applicationShortName: "X", colors: { primary: "not-a-hex" } },
    ACTOR
  );
  assert.equal(ok.applicationName, "X");
});

test("uploadLogo validates type and size", async () => {
  await assert.rejects(
    service.uploadLogo({ mimetype: "text/html", size: 10, buffer: Buffer.from("<b>x</b>"), originalname: "x.html" }, ACTOR),
    ValidationError
  );
  await assert.rejects(
    service.uploadLogo({ mimetype: "image/png", size: 3 * 1024 * 1024, buffer: Buffer.alloc(10), originalname: "x.png" }, ACTOR),
    ValidationError
  );
});

test("uploadLogo stores a PNG and returns a safe reference", async () => {
  const { logo } = await service.uploadLogo(
    { mimetype: "image/png", size: 100, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), originalname: "logo.png" },
    ACTOR
  );
  assert.ok(logo.url.includes("/branding-assets/"));
  assert.equal(logo.contentType, "image/png");
  assert.equal(logo.sizeBytes, 4);
  assert.ok(storage.files.size === 1, "asset stored");
});

test("uploadLogo sanitizes SVG payloads", () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle onclick="evil()" fill="red"/><a href="javascript:alert(2)"/><style>body{}</style></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.ok(!/<script/i.test(clean), "script removed");
  assert.ok(!/onclick/i.test(clean), "event handler removed");
  assert.ok(!/javascript:/i.test(clean), "javascript URL removed");
  assert.ok(!/<style/i.test(clean), "style removed");
});

test("removeLogo clears the stored asset and returns null reference", async () => {
  await fakes.platformSettingRepository.set(BRANDING_KEY, {
    applicationName: "X",
    applicationShortName: "X",
    logo: { url: "/api/v1/platform/branding-assets/logo/abc.png", fileName: "a.png" },
    colors: {},
  });
  const { logo } = await service.removeLogo(ACTOR);
  assert.equal(logo, null);
  assert.equal(storage.files.size, 0);
});
