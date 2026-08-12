/**
 * PlatformSettingRepository — persistence for platform configuration values
 * (FR-044 password policy; extensible for FR-032). Values are stored as a
 * single document per key; reads fall back to the caller-provided default.
 */

const { PlatformSettingModel } = require("../models/platform-setting.model");

class PlatformSettingRepository {
  /** @param {string} key */
  async get(key) {
    const doc = await PlatformSettingModel.findOne({ key }).lean();
    return doc ? doc.value : null;
  }

  /**
   * Upserts a value; never removes a key via null (delete explicitly).
   *
   * @param {string} key
   * @param {unknown} value
   * @param {string|null} updatedBy user id of the actor
   */
  async set(key, value, updatedBy = null) {
    await PlatformSettingModel.findOneAndUpdate(
      { key },
      { $set: { value, updatedBy, updatedAt: new Date() } },
      { upsert: true }
    );
    return { key, value, updatedBy, updatedAt: new Date() };
  }
}

module.exports = { PlatformSettingRepository };
