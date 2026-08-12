/**
 * Mongoose schema + model for the `filter_presets` collection (FR-047).
 *
 * Owner-scoped saved filter sets for lists and reports. `filters` is a free
 * Mixed object validated at the domain and DTO layer (size-bounded to 64 KB).
 */

const mongoose = require("mongoose");

const filterPresetSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    route: { type: String, required: true, index: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  }
);

filterPresetSchema.index({ ownerId: 1, route: 1, createdAt: -1 });

const FilterPresetModel = mongoose.model("FilterPreset", filterPresetSchema);

module.exports = { FilterPresetModel };
