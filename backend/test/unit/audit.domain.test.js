/**
 * Audit & Activity domain tests (FR-012 / FR-013): event catalog,
 * classification, secret scrubbing, hash-chain invariants.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  AUDIT_EVENTS,
  ACTIVITY_ONLY_EVENTS,
  classifyEvent,
  assertRegisteredEvent,
  scrubMetadata,
  computeEventHash,
  generateCorrelationId,
} = require("../../src/domain/audit");

test("every event action is a registered string", () => {
  for (const action of AUDIT_EVENTS) {
    assert.doesNotThrow(() => assertRegisteredEvent(action));
  }
});

test("unknown event actions are rejected", () => {
  assert.throws(() => assertRegisteredEvent("TOTALLY.UNKNOWN"), /Unknown audit/);
});

test("classification places events on the right surfaces", () => {
  assert.deepEqual(classifyEvent("AUTH.SIGNIN_SUCCESS"), { audit: true, activity: false });
  assert.deepEqual(classifyEvent("AUTH.DENIED"), { audit: true, activity: false });
  assert.deepEqual(classifyEvent("REQUEST.APPROVED"), { audit: true, activity: true });
  assert.deepEqual(classifyEvent("PROFILE.VIEWED"), { audit: false, activity: true });
});

test("secret scrubbing removes credential-bearing metadata keys", () => {
  const scrubbed = scrubMetadata({
    password: "plain",
    accessToken: "jwt",
    refreshToken: "opaque",
    passwordHash: "hash",
    name: "Jane",
    email: "jane@corp.io",
  });
  assert.deepEqual(scrubbed, { name: "Jane", email: "jane@corp.io" });
});

test("secret scrubbing tolerates empty metadata", () => {
  assert.deepEqual(scrubMetadata(), {});
  assert.deepEqual(scrubMetadata(null), {});
});

test("computeEventHash is deterministic for identical inputs", () => {
  const input = {
    action: "AUTH.DENIED",
    actorUserId: "u_1",
    subjectId: "/route",
    outcome: "DENIED",
    recordedAt: "2026-08-06T00:00:00.000Z",
    salt: "s",
  };
  assert.equal(computeEventHash(input), computeEventHash(input));
});

test("computeEventHash differs when any input changes", () => {
  const base = {
    action: "AUTH.DENIED",
    actorUserId: "u_1",
    outcome: "DENIED",
    recordedAt: "2026-08-06T00:00:00.000Z",
    salt: "s",
  };
  const withPrev = computeEventHash({ ...base, prevHash: "abc" });
  assert.notEqual(withPrev, computeEventHash(base));
  assert.notEqual(
    computeEventHash(base),
    computeEventHash({ ...base, salt: "different-salt" })
  );
});

test("generateCorrelationId produces unique, prefixed ids", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^corr_[0-9a-f]{16}$/);
});
