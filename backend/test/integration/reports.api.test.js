/**
 * Integration tests for the Reporting module (FR-018 / FR-019): preview
 * filtering, Excel/PDF export with governance, and permission gates.
 *
 * Runs against the dedicated `attendance_reports_test` database.
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

const TEST_URI =
  process.env.MONGO_URI_REPORTS_TEST || "mongodb://127.0.0.1:27017/attendance_reports_test";

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
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: { ...config, seed: { ...config.seed, demoData: true } },
  });
});

const VERIFY_BODY = { location: { latitude: -6.2, longitude: 106.8, accuracy: 12, permissionState: "granted", acquisitionStatus: "found" }, camera: { status: "captured", capturedAt: new Date().toISOString(), mediaRef: "/api/v1/attendance/media/test" } };
async function signIn(username, password) {
  const res = await request(app)
    .post("/api/v1/auth/signin")
    .send({ username, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function seedLeave(asToken) {
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set("Authorization", `Bearer ${asToken}`)
    .send({ leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03", reason: "Vacation" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

async function annualLeaveTypeId(asToken) {
  const res = await request(app)
    .get("/api/v1/leave/types")
    .set("Authorization", `Bearer ${asToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const annual = (res.body.data?.items ?? []).find((t) => t.key === "ANNUAL");
  assert.ok(annual, "seeded ANNUAL leave type present");
  return annual.id;
}

async function demamSicknessTypeId(asToken) {
  const res = await request(app)
    .get("/api/v1/sickness-types")
    .set("Authorization", `Bearer ${asToken}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const demam = (res.body.data ?? []).find((t) => t.key === "DEMAM");
  assert.ok(demam, "seeded DEMAM sickness type present");
  return demam.id;
}

test("F4: HR previews a filtered leave report; results match the filters", async () => {
  const employee = await signIn("employee", "Employee2026!");
  await seedLeave(employee.accessToken);

  const hr = await signIn("hradmin", "HrAdmin2026!");

  const types = await request(app)
    .get("/api/v1/reports/types")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(types.status, 200);
  assert.equal(types.body.data.items.length, 5);
  assert.ok(
    types.body.data.items.some((t) => t.key === "SAKIT" && t.columns.includes("sicknessType")),
    "SAKIT report type present"
  );

  // Broad date range matches the freshly submitted leave.
  const preview = await request(app)
    .get("/api/v1/reports/leave")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ from: "2026-08-01", to: "2026-08-31", status: "PENDING" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.total, 1);
  assert.equal(preview.body.data.items[0].leaveType, "Annual Leave");
  assert.equal(preview.body.data.items[0].status, "PENDING");
  assert.equal(preview.body.data.items[0].employee, "Demo Employee");

  // A range far in the past matches nothing.
  const empty = await request(app)
    .get("/api/v1/reports/leave")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ from: "2020-01-01", to: "2020-01-31" });
  assert.equal(empty.body.data.total, 0);
});

test("F8: SAKIT report preview shows the sickness type name (not an ObjectId)", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const demamId = await demamSicknessTypeId(employee.accessToken);

  const submitted = await request(app)
    .post("/api/v1/sakit/requests")
    .set("Authorization", `Bearer ${employee.accessToken}`)
    .send({ sicknessType: demamId, startDate: "2026-09-01", endDate: "2026-09-02", reason: "Demam" });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));

  const hr = await signIn("hradmin", "HrAdmin2026!");
  const preview = await request(app)
    .get("/api/v1/reports/sakit")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ from: "2026-08-01", to: "2026-08-31" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.total, 1);
  assert.equal(preview.body.data.items[0].sicknessType, "Demam", "name resolved via repository");
  assert.equal(preview.body.data.items[0].employee, "Demo Employee");
});

test("F9: employeeSearch filters rows to matching name/username users", async () => {
  const bob = await signIn("employee.bob", "Employee2026!");
  await seedLeave(bob.accessToken);
  const employee = await signIn("employee", "Employee2026!");
  await seedLeave(employee.accessToken);

  const hr = await signIn("hradmin", "HrAdmin2026!");

  const all = await request(app)
    .get("/api/v1/reports/leave")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ from: "2026-08-01", to: "2026-08-31" });
  assert.equal(all.body.data.total, 2, "two leave rows without a search");

  // The test DB is dropped per-test; ensure the user schema's text index
  // (user.model.js) exists so the $text employeeSearch query works.
  const { UserModel } = require("../../src/infrastructure/models/user.model");
  await UserModel.syncIndexes();

  const searched = await request(app)
    .get("/api/v1/reports/leave")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ from: "2026-08-01", to: "2026-08-31", employeeSearch: "bob" });
  assert.equal(searched.status, 200, JSON.stringify(searched.body));
  assert.equal(searched.body.data.total, 1, "only employee.bob matches");
});

test("F5: Excel export streams a real .xlsx and records REPORT.EXPORTED", async () => {
  const employee = await signIn("employee", "Employee2026!");
  await seedLeave(employee.accessToken);
  const hr = await signIn("hradmin", "HrAdmin2026!");

  const excel = await request(app)
    .get("/api/v1/reports/leave/export")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ format: "excel", from: "2026-08-01", to: "2026-08-31" });
  assert.equal(excel.status, 200);
  assert.match(excel.headers["content-type"], /spreadsheetml/);
  assert.match(excel.headers["content-disposition"], /leave-report\.xlsx/);
  assert.ok(excel.text.startsWith("PK"), "xlsx zip signature");

  // PDF is no longer accepted.
  const pdf = await request(app)
    .get("/api/v1/reports/leave/export")
    .set("Authorization", `Bearer ${hr.accessToken}`)
    .query({ format: "pdf", from: "2026-08-01", to: "2026-08-31" });
  assert.equal(pdf.status, 400, "format=pdf rejected");

  // The export is recorded with actor + format.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const audit = await request(app)
    .get("/api/v1/audit/events")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .query({ action: "REPORT.EXPORTED", pageSize: 100 });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.data.total, 1, "one REPORT.EXPORTED per export");
  assert.equal(audit.body.data.items[0].metadata.format, "excel");
});

test("F6: export is denied without the format-specific permission; employees cannot access reports", async () => {
  // An employee has no reporting permission at all → 403 on the surface.
  const employee = await signIn("employee", "Employee2026!");
  const employeeDenied = await request(app)
    .get("/api/v1/reports/types")
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(employeeDenied.status, 403);

  // A role with reporting:view but no export permission: create it and assign.
  const admin = await signIn("superadmin", createConfig().seed.superAdminPassword);
  const created = await request(app)
    .post("/api/v1/rbac/admin/roles")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ name: "Report Viewer", permissions: ["reporting:view"] });
  assert.equal(created.status, 201);
  const roleId = created.body.data.id;

  const { UserModel } = require("../../src/infrastructure/models/user.model");
  const { BcryptPasswordHasher: Hasher } = require("../../src/infrastructure/password-hasher");
  const hasher = new Hasher(4);
  const viewer = await UserModel.create({
    username: "reportviewer",
    email: "reportviewer@corp.io",
    name: "Report Viewer",
    passwordHash: await hasher.hash("Viewer2026!"),
    status: "ACTIVE",
  });
  const assigned = await request(app)
    .put(`/api/v1/rbac/users/${viewer.id}/roles`)
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ roleIds: [roleId] });
  assert.equal(assigned.status, 200);

  const viewerSession = await signIn("reportviewer", "Viewer2026!");
  const viewerPreview = await request(app)
    .get("/api/v1/reports/types")
    .set("Authorization", `Bearer ${viewerSession.accessToken}`);
  assert.equal(viewerPreview.status, 200, "view-only role can preview");

  const viewerExport = await request(app)
    .get("/api/v1/reports/attendance/export")
    .set("Authorization", `Bearer ${viewerSession.accessToken}`)
    .query({ format: "excel" });
  assert.equal(viewerExport.status, 403, "view-only role cannot export");
  assert.equal(
    viewerExport.body.error.permissionKey,
    "reporting:export_excel",
    "denial names the missing permission"
  );
});

test("F7: attendance report preview reflects the attendance module data", async () => {
  const employee = await signIn("employee", "Employee2026!");
  const clockIn = await request(app)
    .post("/api/v1/attendance/clock-in")
    .send(VERIFY_BODY)
    .set("Authorization", `Bearer ${employee.accessToken}`);
  assert.equal(clockIn.status, 200);

  const hr = await signIn("hradmin", "HrAdmin2026!");
  const preview = await request(app)
    .get("/api/v1/reports/attendance")
    .set("Authorization", `Bearer ${hr.accessToken}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.total, 1);
  assert.equal(preview.body.data.items[0].date, clockIn.body.data.date);
});
