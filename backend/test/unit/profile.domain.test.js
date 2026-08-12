/**
 * Profile domain tests (FR-021): self-service field registry, HR-field
 * rejection, field validation, and bank-account masking.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  SELF_SERVICE_FIELDS,
  HR_MANAGED_FIELDS,
  isSelfServiceField,
  assertEditableFields,
  validateProfileUpdate,
  maskBankAccount,
} = require("../../src/domain/profile");
const {
  ValidationError,
  FieldNotEditableError,
} = require("../../src/domain/errors");

test("the registry separates self-service from HR-managed fields", () => {
  for (const field of SELF_SERVICE_FIELDS) {
    assert.equal(isSelfServiceField(field), true, `${field} is self-service`);
  }
  for (const field of HR_MANAGED_FIELDS) {
    assert.equal(isSelfServiceField(field), false, `${field} is HR-managed`);
  }
  assert.ok(HR_MANAGED_FIELDS.includes("name"));
  assert.ok(HR_MANAGED_FIELDS.includes("status"));
  assert.ok(HR_MANAGED_FIELDS.includes("departmentId"));
  assert.ok(HR_MANAGED_FIELDS.includes("roles"));
});

test("assertEditableFields accepts only self-service updates (E1)", () => {
  assert.doesNotThrow(() =>
    assertEditableFields({ phone: "+1-555-0100", address: "Main St" })
  );
  assert.throws(
    () => assertEditableFields({ name: "Hacker" }),
    (err) => err instanceof FieldNotEditableError && err.code === "FIELD_NOT_EDITABLE"
  );
  assert.throws(
    () => assertEditableFields({ status: "INACTIVE", phone: "x" }),
    (err) => err instanceof FieldNotEditableError && err.details.field === "status"
  );
});

test("validateProfileUpdate rejects malformed emails and enforces length", () => {
  assert.doesNotThrow(() => validateProfileUpdate({ phone: "+1-555-0100" }));
  assert.throws(
    () => validateProfileUpdate({ email: "not-an-email" }),
    (err) => err instanceof ValidationError && err.details.field === "email"
  );
  assert.throws(
    () => validateProfileUpdate({ personalEmail: "nope" }),
    ValidationError
  );
  assert.throws(
    () => validateProfileUpdate({ address: "x".repeat(300) }),
    (err) => err instanceof ValidationError && err.details.field === "address"
  );
});

test("maskBankAccount shows only the last four digits", () => {
  assert.equal(maskBankAccount("1234567890"), "****7890");
  assert.equal(maskBankAccount("1234"), "****");
  assert.equal(maskBankAccount(null), null);
  assert.equal(maskBankAccount(""), null);
});
