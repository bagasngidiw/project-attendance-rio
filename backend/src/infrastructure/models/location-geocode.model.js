/**
 * Cached reverse-geocoded attendance locations.
 *
 * Attendance documents intentionally remain coordinate-only. This cache keeps
 * report generation fast and avoids changing historical attendance records.
 */

const mongoose = require("mongoose");

const locationGeocodeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, required: true, trim: true },
    provider: { type: String, required: true, default: "photon" },
    resolvedAt: { type: Date, required: true, default: Date.now },
  },
  {
    collection: "location_geocodes",
    timestamps: true,
    versionKey: false,
  }
);

const LocationGeocodeModel = mongoose.model("LocationGeocode", locationGeocodeSchema);

module.exports = { LocationGeocodeModel };
