/**
 * LocalDiskStorage tests (FR-017): write/read/delete round trips on a real
 * temp directory plus sandbox-escape rejection.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");

const { LocalDiskStorage } = require("../../src/infrastructure/storage/local-disk.storage");
const { NotFoundError, ValidationError } = require("../../src/domain/errors");

const TEMP_BASE = "C:/Users/MYBOOK~1/AppData/Local/Temp/opencode";

async function makeStorage(t) {
  const dir = await fs.mkdtemp(path.join(TEMP_BASE, "attachment-storage-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new LocalDiskStorage({ storageDir: dir });
}

test("attachment local-disk storage: write/read/delete round trip", async (t) => {
  const storage = await makeStorage(t);
  const key = "req1/receipt.pdf";
  const buffer = Buffer.from("fake-pdf-bytes");

  await storage.save({ key, buffer });

  assert.equal(await storage.exists(key), true);
  assert.deepEqual(await storage.read(key), buffer);

  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
});

test("attachment local-disk storage: writes nested keys inside the sandbox", async (t) => {
  const storage = await makeStorage(t);
  await storage.save({ key: "sub/dir/evidence.txt", buffer: Buffer.from("nested") });

  const full = path.join(storage.storageDir, "sub", "dir", "evidence.txt");
  assert.equal(await fs.readFile(full, "utf8"), "nested");
});

test("attachment local-disk storage: read of a missing key throws NotFoundError", async (t) => {
  const storage = await makeStorage(t);
  await assert.rejects(
    storage.read("missing.pdf"),
    (err) =>
      err instanceof NotFoundError && err.code === "ATTACHMENT_NOT_FOUND"
  );
});

test("attachment local-disk storage: delete is idempotent", async (t) => {
  const storage = await makeStorage(t);
  await storage.save({ key: "a.txt", buffer: Buffer.from("x") });

  await storage.delete("a.txt");
  await storage.delete("a.txt");
  assert.equal(await storage.exists("a.txt"), false);
});

test("attachment local-disk storage: rejects keys that escape the sandbox", async (t) => {
  const storage = await makeStorage(t);
  const payload = Buffer.from("escape");

  for (const key of [
    "../escape.txt",
    "..\\escape.txt",
    path.join("..", "escape.txt"),
    "sub/../../../escape.txt",
    "C:/Windows/Temp/evil.txt",
  ]) {
    await assert.rejects(
      storage.save({ key, buffer: payload }),
      (err) => err instanceof ValidationError,
      `expected save(${JSON.stringify(key)}) to be rejected`
    );
    await assert.rejects(
      storage.read(key),
      ValidationError,
      `expected read(${JSON.stringify(key)}) to be rejected`
    );
    await assert.rejects(
      storage.delete(key),
      ValidationError,
      `expected delete(${JSON.stringify(key)}) to be rejected`
    );
  }
});

test("attachment local-disk storage: rejects empty or non-string keys", async (t) => {
  const storage = await makeStorage(t);
  await assert.rejects(
    storage.save({ key: "", buffer: Buffer.from("x") }),
    ValidationError
  );
  await assert.rejects(
    storage.save({ key: undefined, buffer: Buffer.from("x") }),
    ValidationError
  );
  await assert.rejects(storage.read(""), ValidationError);
  await assert.rejects(storage.exists(""), ValidationError);
});
