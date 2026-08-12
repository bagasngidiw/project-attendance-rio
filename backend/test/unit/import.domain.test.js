/**
 * Import domain tests (FR-061): CSV parsing (BOM, CRLF, bad rows, strict
 * column counts), JSON parsing, and per-row validation (required fields,
 * email shape, role existence, batch-level username duplicates).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseImportRows,
  validateImportRow,
} = require("../../src/domain/import");

const ROLES = [
  { id: "r_emp", key: "EMPLOYEE" },
  { id: "r_mgr", key: "MANAGER" },
];

const HEADER = "username,email,name,roleKey";

test("CSV parsing tolerates a BOM and CRLF line endings", () => {
  const raw = `\uFEFF${HEADER}\r\njohn,John@corp.io,John Doe,EMPLOYEE\r\nana,ana@corp.io,Ana Demo,MANAGER\r\n`;
  const { rows, errors } = parseImportRows(raw, "csv");

  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].values, {
    username: "john",
    email: "John@corp.io",
    name: "John Doe",
    roleKey: "EMPLOYEE",
  });
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[1].rowNumber, 3);
});

test("CSV parsing strips trailing blank lines without producing phantom rows", () => {
  const raw = `${HEADER}\njohn,john@corp.io,John Doe,EMPLOYEE\n\n\n`;
  const { rows, errors } = parseImportRows(raw, "csv");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
});

test("CSV parsing reports a strict row-length mismatch as a row error", () => {
  const raw = `${HEADER}\njohn,john@corp.io,John Doe\n`;
  const { rows, errors } = parseImportRows(raw, "csv");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 2);
  assert.match(errors[0].message, /Expected 4 columns but found 3/);
});

test("CSV parsing rejects a malformed header with a row-1 error", () => {
  const raw = "name,email\nJohn,john@corp.io\n";
  const { rows, errors } = parseImportRows(raw, "csv");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 1);
  assert.match(errors[0].message, /CSV header must be username,email,name,roleKey/);
});

test("CSV parsing supports quoted fields and escaped quotes", () => {
  const raw = `${HEADER}\n"doe, john","john@corp.io","John ""Big"" Doe",EMPLOYEE\n`;
  const { rows, errors } = parseImportRows(raw, "csv");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.username, "doe, john");
  assert.equal(rows[0].values.name, 'John "Big" Doe');
});

test("CSV parsing reports an empty file as an error", () => {
  const { rows, errors } = parseImportRows("", "csv");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
});

test("JSON parsing maps array elements to rows with 1-based row numbers", () => {
  const raw = JSON.stringify([
    { username: "john", email: "john@corp.io", name: "John Doe", roleKey: "EMPLOYEE" },
    { username: "ana", email: "ana@corp.io", name: "Ana", roleKey: "MANAGER" },
  ]);
  const { rows, errors } = parseImportRows(raw, "json");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowNumber, 1);
  assert.equal(rows[1].rowNumber, 2);
  assert.equal(rows[1].values.username, "ana");
});

test("JSON parsing rejects non-array content", () => {
  const { rows, errors } = parseImportRows('{"username":"john"}', "json");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 0);
});

test("JSON parsing rejects malformed JSON", () => {
  const { rows, errors } = parseImportRows("{not json", "json");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /not valid JSON/);
});

test("JSON parsing flags non-object elements per row", () => {
  const raw = JSON.stringify([{ username: "john", email: "john@corp.io", name: "John", roleKey: "EMPLOYEE" }, "oops"]);
  const { rows, errors } = parseImportRows(raw, "json");
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 2);
});

test("validateImportRow accepts a complete row with a known role", () => {
  const result = validateImportRow(
    { username: "john", email: "john@corp.io", name: "John Doe", roleKey: "employee" },
    { roles: ROLES }
  );
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.username, "john");
  assert.equal(result.roleKey, "EMPLOYEE");
});

test("validateImportRow flags missing required fields", () => {
  const result = validateImportRow({ username: "", email: "", name: "", roleKey: "" }, { roles: ROLES });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("username is required")));
  assert.ok(result.errors.some((e) => e.includes("email is required")));
  assert.ok(result.errors.some((e) => e.includes("name is required")));
  assert.ok(result.errors.some((e) => e.includes("roleKey is required")));
});

test("validateImportRow rejects an invalid email", () => {
  const result = validateImportRow(
    { username: "john", email: "not-an-email", name: "John", roleKey: "EMPLOYEE" },
    { roles: ROLES }
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("valid email address")));
});

test("validateImportRow rejects an unknown roleKey", () => {
  const result = validateImportRow(
    { username: "john", email: "john@corp.io", name: "John", roleKey: "SUPER_VISOR" },
    { roles: ROLES }
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('roleKey "SUPER_VISOR" is not a valid role')));
});

test("validateImportRow rejects duplicate usernames within a batch", () => {
  const seen = new Set();
  const first = validateImportRow(
    { username: "john", email: "john@corp.io", name: "John", roleKey: "EMPLOYEE" },
    { roles: ROLES, seenUsernames: seen }
  );
  assert.equal(first.valid, true);

  const second = validateImportRow(
    { username: "JOHN", email: "other@corp.io", name: "Other", roleKey: "EMPLOYEE" },
    { roles: ROLES, seenUsernames: seen }
  );
  assert.equal(second.valid, false);
  assert.ok(second.errors.some((e) => e.includes("duplicated within the batch")));
});

test("validateImportRow accepts plain string role lists", () => {
  const result = validateImportRow(
    { username: "john", email: "john@corp.io", name: "John", roleKey: "manager" },
    { roles: ["EMPLOYEE", "MANAGER"] }
  );
  assert.equal(result.valid, true);
});
