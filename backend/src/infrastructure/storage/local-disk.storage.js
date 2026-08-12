/**
 * LocalDiskStorage — sandboxed filesystem storage (FR-017).
 *
 * Every key is resolved against the configured storage directory and rejected
 * when the resolved path would escape it, so callers can never read or write
 * outside the sandbox. Uses only node:fs/promises + path (no drivers).
 */

const path = require("path");
const fs = require("node:fs/promises");
const { NotFoundError, ValidationError } = require("../../domain/errors");

class LocalDiskStorage {
  /**
   * @param {{ storageDir?: string }} options
   */
  constructor({ storageDir = path.join(process.cwd(), "uploads") } = {}) {
    this.storageDir = path.resolve(storageDir);
  }

  /**
   * Writes a buffer at the given key (nested directories are created).
   *
   * @param {{ key: string, buffer: Buffer }} input
   * @returns {Promise<string>} the key
   */
  async save({ key, buffer }) {
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return key;
  }

  /**
   * Reads a key back as a Buffer.
   *
   * @param {string} key
   * @throws {NotFoundError} when the key does not exist
   */
  async read(key) {
    const target = this.resolveKey(key);
    try {
      return await fs.readFile(target);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new NotFoundError("File not found.", "ATTACHMENT_NOT_FOUND");
      }
      throw err;
    }
  }

  /**
   * Removes a key. Idempotent — deleting a missing key is a no-op.
   *
   * @param {string} key
   */
  async delete(key) {
    const target = this.resolveKey(key);
    try {
      await fs.unlink(target);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  }

  /** @param {string} key */
  async exists(key) {
    const target = this.resolveKey(key);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves a key inside the sandbox, rejecting keys that would escape it.
   *
   * @param {string} key
   * @throws {ValidationError}
   */
  resolveKey(key) {
    if (typeof key !== "string" || key === "") {
      throw new ValidationError("Invalid storage key.", { field: "key" });
    }
    const resolved = path.resolve(this.storageDir, key);
    const relative = path.relative(this.storageDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ValidationError("Invalid storage key.", { field: "key" });
    }
    return resolved;
  }
}

module.exports = { LocalDiskStorage };
