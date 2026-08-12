/**
 * Retention domain tests (FR-040): policy normalization (merge + validation)
 * and expiry evaluation incl. legal holds and keep-forever categories.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_RETENTION_POLICY,
  normalizeRetentionPolicy,
  isExpired,
} = require("../../src/domain/retention");
const { ValidationError } = require("../../src/domain/errors");

test("normalizeRetentionPolicy returns defaults for empty input", () => {
  const policy = normalizeRetentionPolicy(null);
  assert.equal(policy.auditEventsDays, DEFAULT_RETENTION_POLICY.auditEventsDays);
  assert.equal(policy.activityLogsDays, DEFAULT_RETENTION_POLICY.activityLogsDays);
  assert.equal(policy.attachmentsDays, DEFAULT_RETENTION_POLICY.attachmentsDays);
  assert.equal(policy.requestsDays, DEFAULT_RETENTION_POLICY.requestsDays);
  assert.equal(policy.usersDays, null);
  assert.deepEqual(policy.legalHold, []);
});

test("normalizeRetentionPolicy merges provided values over the defaults", () => {
  const policy = normalizeRetentionPolicy({ auditEventsDays: 90, usersDays: 3650 });
  assert.equal(policy.auditEventsDays, 90);
  assert.equal(policy.usersDays, 3650);
  assert.equal(policy.activityLogsDays, DEFAULT_RETENTION_POLICY.activityLogsDays);
});

test("normalizeRetentionPolicy accepts zero as immediate expiry", () => {
  const policy = normalizeRetentionPolicy({ activityLogsDays: 0 });
  assert.equal(policy.activityLogsDays, 0);
});

test("normalizeRetentionPolicy rejects negative day counts", () => {
  assert.throws(
    () => normalizeRetentionPolicy({ auditEventsDays: -1 }),
    (err) => err instanceof ValidationError && err.details.field === "auditEventsDays"
  );
});

test("normalizeRetentionPolicy rejects non-integer day counts", () => {
  assert.throws(
    () => normalizeRetentionPolicy({ activityLogsDays: 1.5 }),
    (err) => err instanceof ValidationError && err.details.field === "activityLogsDays"
  );
  assert.throws(
    () => normalizeRetentionPolicy({ requestsDays: "30" }),
    (err) => err instanceof ValidationError && err.details.field === "requestsDays"
  );
});

test("normalizeRetentionPolicy rejects non-object policies", () => {
  assert.throws(
    () => normalizeRetentionPolicy("nope"),
    (err) => err instanceof ValidationError
  );
  assert.throws(
    () => normalizeRetentionPolicy([1, 2]),
    (err) => err instanceof ValidationError
  );
});

test("legal hold entries are normalized to { type, id } and validated", () => {
  const policy = normalizeRetentionPolicy({
    legalHold: [
      { type: "USER", id: "u_1" },
      { type: "REQUEST", id: "req_9", note: "case 7" },
    ],
  });
  assert.deepEqual(policy.legalHold, [
    { type: "USER", id: "u_1" },
    { type: "REQUEST", id: "req_9" },
  ]);

  assert.throws(
    () => normalizeRetentionPolicy({ legalHold: [{ type: "USER" }] }),
    (err) => err instanceof ValidationError && err.details.field === "legalHold"
  );
  assert.throws(
    () => normalizeRetentionPolicy({ legalHold: [{ id: "u_1" }] }),
    (err) => err instanceof ValidationError && err.details.field === "legalHold"
  );
  assert.throws(
    () => normalizeRetentionPolicy({ legalHold: "not-an-array" }),
    (err) => err instanceof ValidationError && err.details.field === "legalHold"
  );
  assert.throws(
    () => normalizeRetentionPolicy({ legalHold: [null] }),
    (err) => err instanceof ValidationError && err.details.field === "legalHold"
  );
});

test("isExpired never expires records on legal hold", () => {
  assert.equal(
    isExpired({
      recordedAt: new Date("2010-01-01T00:00:00Z"),
      retentionDays: 30,
      onLegalHold: true,
      now: new Date("2026-01-01T00:00:00Z"),
    }),
    false
  );
});

test("isExpired never expires when retentionDays is null (keep forever)", () => {
  assert.equal(
    isExpired({
      recordedAt: new Date("2010-01-01T00:00:00Z"),
      retentionDays: null,
      now: new Date("2026-01-01T00:00:00Z"),
    }),
    false
  );
});

test("isExpired expires records older than the cutoff window", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date("2025-01-01T00:00:00Z");
  const recent = new Date("2025-12-30T00:00:00Z");
  assert.equal(isExpired({ recordedAt: old, retentionDays: 60, now }), true);
  assert.equal(isExpired({ recordedAt: recent, retentionDays: 60, now }), false);
});

test("isExpired boundary: exactly at the cutoff is not yet expired", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const exactly = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  assert.equal(isExpired({ recordedAt: exactly, retentionDays: 30, now }), false);
  const oneMsOlder = new Date(exactly.getTime() - 1);
  assert.equal(isExpired({ recordedAt: oneMsOlder, retentionDays: 30, now }), true);
});

test("isExpired accepts ISO string recordedAt and ignores invalid dates", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    isExpired({ recordedAt: "2010-01-01T00:00:00Z", retentionDays: 30, now }),
    true
  );
  assert.equal(isExpired({ recordedAt: "not-a-date", retentionDays: 30, now }), false);
});
