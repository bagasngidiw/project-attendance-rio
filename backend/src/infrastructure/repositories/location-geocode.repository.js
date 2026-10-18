/** Persistence adapter for cached reverse-geocoded coordinates. */

const { LocationGeocodeModel } = require("../models/location-geocode.model");

class LocationGeocodeRepository {
  async findByKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    return LocationGeocodeModel.find({ key: { $in: keys } }).lean();
  }

  async upsert({ key, latitude, longitude, address, provider = "photon", resolvedAt = new Date() }) {
    return LocationGeocodeModel.findOneAndUpdate(
      { key },
      {
        $set: {
          latitude,
          longitude,
          address,
          provider,
          resolvedAt,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean();
  }
}

module.exports = { LocationGeocodeRepository };
