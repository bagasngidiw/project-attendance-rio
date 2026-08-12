/**
 * FilterPresetRepository — persistence for saved filter presets (FR-047).
 * All reads/writes are owner-scoped so a user can never see or mutate another
 * user's presets.
 */

const { FilterPresetModel } = require("../models/filter-preset.model");

class FilterPresetRepository {
  /** @param {{ ownerId: string, name: string, route: string, filters: object }} input */
  async create({ ownerId, name, route, filters }) {
    return FilterPresetModel.create({ ownerId, name, route, filters });
  }

  /** Owner-scoped read; returns the doc or null (no existence leak). */
  async findByIdScoped(id, ownerId) {
    return FilterPresetModel.findOne({ _id: id, ownerId }).lean();
  }

  /**
   * Owner-scoped list, newest first, optionally filtered by route.
   *
   * @param {string} ownerId
   * @param {{ route?: string, page?: number, pageSize?: number }} options
   */
  async listByOwner(ownerId, { route, page = 1, pageSize = 20 } = {}) {
    const query = { ownerId };
    if (route) query.route = route;
    const [items, total] = await Promise.all([
      FilterPresetModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      FilterPresetModel.countDocuments(query),
    ]);
    return { items, total };
  }

  /** Owner-scoped update. Returns the updated doc or null. */
  async update(id, ownerId, patch) {
    return FilterPresetModel.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: patch },
      { returnDocument: "after" }
    );
  }

  /** Owner-scoped delete. Returns the removed doc or null. */
  async delete(id, ownerId) {
    return FilterPresetModel.findOneAndDelete({ _id: id, ownerId });
  }
}

module.exports = { FilterPresetRepository };
