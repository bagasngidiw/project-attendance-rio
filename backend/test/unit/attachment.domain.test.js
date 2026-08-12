/**
 * Attachment domain tests (FR-017): upload validation (allowed types, size,
 * names, traversal) and stored-name sanitization.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateUpload,
  sanitizeStoredName,
  MAX_ORIGINAL_NAME_LENGTH,
} = require("../../src/domain/attachment");
const { ValidationError } = require("../../src/domain/errors");

const POLICY = {
  allowedTypes: ["application/pdf", "image/png", "image/jpeg"],
  maxSizeBytes: 5 * 1024 * 1024,
};

function validFile(overrides = {}) {
  return {
    mimeType: "application/pdf",
    sizeBytes: 1024,
    originalName: "receipt.pdf",
    ...overrides,
  };
}

test("attachment validateUpload accepts an allowed file under the size limit", () => {
  validateUpload(validFile(), POLICY);
  validateUpload(validFile({ mimeType: "image/png" }), POLICY);
  validateUpload(
    validFile({ sizeBytes: POLICY.maxSizeBytes }),
    POLICY
  );
});

test("attachment validateUpload rejects an unlisted mime type", () => {
  assert.throws(
    () => validateUpload(validFile({ mimeType: "text/html" }), POLICY),
    (err) => err instanceof ValidationError && err.details.field === "mimeType"
  );
  assert.throws(
    () => validateUpload(validFile({ mimeType: undefined }), POLICY),
    (err) => err instanceof ValidationError && err.details.field === "mimeType"
  );
});

test("attachment validateUpload rejects files over the max size", () => {
  assert.throws(
    () =>
      validateUpload(
        validFile({ sizeBytes: POLICY.maxSizeBytes + 1 }),
        POLICY
      ),
    (err) =>
      err instanceof ValidationError &&
      err.details.field === "sizeBytes" &&
      err.message.includes(String(POLICY.maxSizeBytes))
  );
});

test("attachment validateUpload rejects zero and negative sizes", () => {
  for (const sizeBytes of [0, -1, -4096]) {
    assert.throws(
      () => validateUpload(validFile({ sizeBytes }), POLICY),
      (err) =>
        err instanceof ValidationError && err.details.field === "sizeBytes"
    );
  }
});

test("attachment validateUpload rejects empty or missing original names", () => {
  for (const originalName of ["", "   ", undefined, null]) {
    assert.throws(
      () => validateUpload(validFile({ originalName }), POLICY),
      (err) =>
        err instanceof ValidationError && err.details.field === "originalName"
    );
  }
});

test("attachment validateUpload rejects oversized original names (> 255 chars)", () => {
  const originalName = "a".repeat(MAX_ORIGINAL_NAME_LENGTH + 1) + ".pdf";
  assert.throws(
    () => validateUpload(validFile({ originalName }), POLICY),
    (err) =>
      err instanceof ValidationError && err.details.field === "originalName"
  );
  // Exactly 255 chars is still fine.
  validateUpload(validFile({ originalName: "a".repeat(MAX_ORIGINAL_NAME_LENGTH) }), POLICY);
});

test("attachment validateUpload rejects path-traversal characters in the original name", () => {
  const traversalNames = [
    "../secret.pdf",
    "..\\secret.pdf",
    "dir/secret.pdf",
    "dir\\secret.pdf",
    "..",
    "folder/../../secret.pdf",
  ];
  for (const originalName of traversalNames) {
    assert.throws(
      () => validateUpload(validFile({ originalName }), POLICY),
      (err) =>
        err instanceof ValidationError && err.details.field === "originalName",
      `expected ${JSON.stringify(originalName)} to be rejected`
    );
  }
});

test("attachment sanitizeStoredName returns a UUID-prefixed, cleaned basename", () => {
  const stored = sanitizeStoredName("quarterly report (final).pdf");
  assert.match(
    stored,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-quarterlyreportfinal\.pdf$/
  );
  assert.ok(!stored.includes(" "));
  assert.ok(!stored.includes("("));
  assert.ok(!stored.includes(")"));
});

test("attachment sanitizeStoredName keeps safe characters and strips special chars", () => {
  const stored = sanitizeStoredName("My_Invoice.DRAFT.v2.png");
  assert.match(stored, /-My_Invoice\.DRAFT\.v2\.png$/);
});

test("attachment sanitizeStoredName extracts the basename defensively", () => {
  assert.match(sanitizeStoredName("some/dir/evidence.txt"), /-evidence\.txt$/);
});

test("attachment sanitizeStoredName falls back to 'file' when nothing remains", () => {
  const stored = sanitizeStoredName("!!!");
  assert.match(stored, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-file$/);
});
