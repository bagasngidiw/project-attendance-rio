/**
 * Integration tests for platform branding (FR-001/FR-002/FR-003/FR-007):
 * GET defaults, PUT persist + audit, 403 for non-admins, logo upload + fetch.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");

require("dotenv").config();

const { buildApp } = require("../../server");
const { createConfig } = require("../../src/infrastructure/config");
const { BcryptPasswordHasher } = require("../../src/infrastructure/password-hasher");
const { seedDatabase } = require("../../src/infrastructure/seed/seed");

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/attendance_test";

let app;
let config;

before(async () => {
  config = createConfig();
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const { app: built } = buildApp(config);
  app = built;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const { app: built, repositories } = buildApp(config);
  app = built;
  await seedDatabase({
    roleRepository: repositories.roleRepository,
    permissionRepository: repositories.permissionRepository,
    userRepository: repositories.userRepository,
    leaveTypeRepository: repositories.leaveTypeRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

async function signIn(username, password) {
  const res = await request(app).post("/api/v1/auth/signin").send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

test("FR-001: GET branding returns identity defaults + FIXED tokens; non-admin 403", async () => {
  const hr = await signIn("hradmin", "HrAdmin2026!");
  const denied = await request(app)
    .get("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(denied.status, 403);

  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .get("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applicationName, "Sistem Informasi Sumber Daya Manusia");
  assert.equal(res.body.data.applicationShortName, "HRIS");
  assert.equal(res.body.data.colors, undefined, "no customer colors exposed");
  assert.equal(res.body.data.tokens["--brand-primary"], "#D90429", "fixed product palette");
  assert.equal(res.body.data.tokens["--brand-background"], "#F7F8FA");
});

test("FR-001: PUT branding persists identity + audit; colors are rejected (product-controlled)", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const res = await request(app)
    .put("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      applicationName: "HRIS Perusahaan",
      applicationShortName: "HRP",
    });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.applicationName, "HRIS Perusahaan");
  assert.equal(res.body.data.tokens["--brand-primary"], "#D90429", "tokens stay fixed");

  // Sending colors is rejected (strict DTO) — customers cannot configure colors.
  const withColors = await request(app)
    .put("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ applicationName: "X", applicationShortName: "X", colors: { primary: "#123456" } });
  assert.equal(withColors.status, 400, "colors payload rejected");

  const again = await request(app)
    .get("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${admin.accessToken}`);
  assert.equal(again.body.data.applicationName, "HRIS Perusahaan");

  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "SETTINGS.CHANGED", pageSize: 20 });
  assert.ok(audit.body.data.total >= 1, "branding change audited");
});

test("FR-001: PUT branding rejects invalid values", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const bad = await request(app)
    .put("/api/v1/platform/settings/branding")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ applicationName: "", applicationShortName: "X" });
  assert.equal(bad.status, 400);
});

test("FR-002: logo upload (PNG) is stored and fetchable; invalid type rejected", async () => {
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);

  const bad = await request(app)
    .post("/api/v1/platform/settings/branding/logo")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "x.html", contentType: "text/html" });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ok = await request(app)
    .post("/api/v1/platform/settings/branding/logo")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .attach("file", png, { filename: "logo.png", contentType: "image/png" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.ok(ok.body.data.logo.url.includes("/branding-assets/"));

  // The asset is publicly fetchable with safe headers.
  const asset = await request(app).get(ok.body.data.logo.url);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers["x-content-type-options"], "nosniff");
  assert.ok(asset.body.length >= 8);
});
